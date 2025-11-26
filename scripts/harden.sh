#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

[[ $EUID -eq 0 ]] || { printf "harden.sh must be run as root (sudo).\n" >&2; exit 2; }

SCRIPT_ERR_LOG="/tmp/harden_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "Harden failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage() {
  cat <<USG
Usage: harden.sh [--ssh] [--ssh-pub <key_or_path>] [--verbose]

Applies basic server hardening:
- installs ufw, fail2ban, unattended-upgrades
- enables fail2ban and unattended-upgrades
- optionally hardens SSH (disable root login, disable password auth) with --ssh
- configures UFW to allow 22,80,443 and enables it

  --ssh                  Also apply SSH hardening (see below)
  --ssh-pub KEY|PATH     Public key content or file to seed authorized_keys if missing
  -v, --verbose          Enable verbose output for debugging
  -h, --help             Show this help
USG
  exit 0
}

user="devpush"; ssh_pub=""; with_ssh=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh) with_ssh=1; shift ;;
    --ssh-pub) ssh_pub="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# Guard: prevent running in development mode
if [[ "$ENVIRONMENT" == "development" ]]; then
  err "harden.sh is for production only."
  exit 1
fi

. /etc/os-release || { err "Unsupported OS"; exit 4; }
case "${ID_LIKE:-$ID}" in
  *debian*|*ubuntu*) : ;;
  *) err "Only Ubuntu/Debian supported"; exit 4 ;;
esac
command -v apt-get >/dev/null || { err "apt-get not found"; exit 4; }

apt_install() {
  local pkgs=("$@"); local i
  for i in {1..5}; do
    if apt-get update -y && apt-get install -y "${pkgs[@]}"; then return 0; fi
    sleep 3
  done
  return 1
}

if ((with_ssh==1)); then
  # Ensure user exists if specified
  if ! id -u "$user" >/dev/null 2>&1; then
    err "User '$user' does not exist."
    exit 5
  fi
fi

if ((with_ssh==1)); then
  # SSH key preflight to avoid lockout
  ak="/home/$user/.ssh/authorized_keys"
  if [[ -n "$ssh_pub" ]]; then
    install -d -m 700 -o "$user" -g "$user" "/home/$user/.ssh"
    if [[ -f "$ssh_pub" ]]; then
      cat "$ssh_pub" >> "$ak"
    else
      printf '%s\n' "$ssh_pub" >> "$ak"
    fi
    chown "$user:$user" "$ak"; chmod 600 "$ak"
  fi

  # If user's keys are still missing, try copying from root
  if [[ ! -s "$ak" && -s /root/.ssh/authorized_keys ]]; then
    install -d -m 700 -o "$user" -g "$user" "/home/$user/.ssh"
    cat /root/.ssh/authorized_keys >> "$ak"
    chown "$user:$user" "$ak"; chmod 600 "$ak"
  fi

  # Deduplicate authorized_keys
  if [[ -f "$ak" ]]; then
    sort -u "$ak" -o "$ak"
    chown "$user:$user" "$ak"; chmod 600 "$ak"
  fi

  if [[ ! -s "$ak" ]]; then
    printf "${YEL}SSH hardening requires a public key.${NC}\n"
    printf "Provide --ssh-pub <key|path> or ensure %s exists and is non-empty.\n" "$ak"
    exit 6
  fi
fi

# Install security packages
printf '\n'
printf "Installing security packages...\n"
run_cmd "${CHILD_MARK} Installing ufw, fail2ban, unattended-upgrades..." apt_install ufw fail2ban unattended-upgrades

# Enable services
printf '\n'
printf "Enabling services...\n"
run_cmd "${CHILD_MARK} Enabling fail2ban..." systemctl enable --now fail2ban
run_cmd "${CHILD_MARK} Enabling unattended-upgrades..." systemctl enable --now unattended-upgrades

if ((with_ssh==1)); then
  # SSH hardening
  printf '\n'
  printf "Hardening SSH...\n"
  if grep -q '^PermitRootLogin' /etc/ssh/sshd_config || grep -q '^#PermitRootLogin' /etc/ssh/sshd_config; then
    run_cmd "${CHILD_MARK} Disabling root login..." sed -ri 's/^#?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  else
    run_cmd "${CHILD_MARK} Disabling root login..." bash -c 'printf "PermitRootLogin no\n" >> /etc/ssh/sshd_config'
  fi
  if grep -q '^PasswordAuthentication' /etc/ssh/sshd_config || grep -q '^#PasswordAuthentication' /etc/ssh/sshd_config; then
    run_cmd "${CHILD_MARK} Disabling password authentication..." sed -ri 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  else
    run_cmd "${CHILD_MARK} Disabling password authentication..." bash -c 'printf "PasswordAuthentication no\n" >> /etc/ssh/sshd_config'
  fi
  if systemctl list-units --type=service --all | grep -q 'ssh.service'; then
    run_cmd "${CHILD_MARK} Restarting SSH service..." systemctl restart ssh
  elif systemctl list-units --type=service --all | grep -q 'sshd.service'; then
    run_cmd "${CHILD_MARK} Restarting SSH service..." systemctl restart sshd
  else
    printf "%s Restarting SSH service... ${YEL}⊘${NC}\n" "$CHILD_MARK"
    printf "  ${DIM}%s Could not find ssh or sshd service${NC}\n" "$CHILD_MARK"
  fi
fi

# Firewall
printf '\n'
printf "Configuring firewall...\n"
run_cmd "${CHILD_MARK} Setting UFW defaults..." bash -c 'ufw default deny incoming && ufw default allow outgoing'
run_cmd "${CHILD_MARK} Allowing port 22 (SSH)..." ufw allow 22
run_cmd "${CHILD_MARK} Allowing port 80 (HTTP)..." ufw allow 80
run_cmd "${CHILD_MARK} Allowing port 443 (HTTPS)..." ufw allow 443
run_cmd "${CHILD_MARK} Enabling UFW..." bash -c 'yes | ufw enable'

# Success message
printf '\n'
printf "${GRN}Hardening complete. ✔${NC}\n"