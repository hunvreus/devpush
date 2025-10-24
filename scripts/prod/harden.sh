#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
exec 2> >(tee /tmp/harden_error.log >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Harden failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/harden_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage() {
  cat <<USG
Usage: harden.sh [--ssh] [--user <name>] [--ssh-pub <key_or_path>] [--verbose]

Applies basic server hardening:
- installs ufw, fail2ban, unattended-upgrades
- enables fail2ban and unattended-upgrades
- optionally hardens SSH (disable root login, disable password auth) with --ssh
- configures UFW to allow 22,80,443 and enables it

  --ssh                  Also apply SSH hardening (see below)
  --user NAME            Target user for SSH key check/seed (default: current user)
  --ssh-pub KEY|PATH     Public key content or file to seed authorized_keys if missing
  -v, --verbose          Enable verbose output for debugging
  -h, --help             Show this help
USG
  exit 1
}

user=""; ssh_pub=""; with_ssh=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh) with_ssh=1; shift ;;
    --user) user="$2"; shift 2 ;;
    --ssh-pub) ssh_pub="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

[[ $EUID -eq 0 ]] || { err "Run as root (sudo)."; exit 2; }

# Ensure user is specified for SSH hardening
if ((with_ssh==1)) && [[ -z "$user" ]]; then
  # Try to get the original user who invoked sudo
  original_user="${SUDO_USER:-$USER}"
  if [[ -z "$original_user" || "$original_user" == "root" ]]; then
    err "SSH hardening requires --user <name> (cannot determine original user)"
    exit 3
  fi
  user="$original_user"
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
      echo "$ssh_pub" >> "$ak"
    fi
    chown "$user:$user" "$ak"; chmod 600 "$ak"
  fi

  # If user's keys are still missing, try copying from root
  if [[ ! -s "$ak" && -s /root/.ssh/authorized_keys ]]; then
    install -d -m 700 -o "$user" -g "$user" "/home/$user/.ssh"
    cat /root/.ssh/authorized_keys >> "$ak"
    chown "$user:$user" "$ak"; chmod 600 "$ak"
  fi

  if [[ ! -s "$ak" ]]; then
    echo -e "${YEL}SSH hardening requires a public key.${NC}"
    echo "Provide --ssh-pub <key|path> or ensure $ak exists and is non-empty."
    exit 6
  fi
fi

# Install security packages
printf "\n"
echo "Installing security packages..."
run_cmd "  ${CHILD_MARK} Installing ufw, fail2ban, unattended-upgrades..." apt_install ufw fail2ban unattended-upgrades

# Enable services
printf "\n"
echo "Enabling services..."
run_cmd "  ${CHILD_MARK} Enabling fail2ban..." systemctl enable --now fail2ban
run_cmd "  ${CHILD_MARK} Enabling unattended-upgrades..." systemctl enable --now unattended-upgrades

if ((with_ssh==1)); then
  # SSH hardening
  printf "\n"
  echo "Hardening SSH..."
  run_cmd "  ${CHILD_MARK} Disabling root login..." sed -ri 's/^#?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  run_cmd "  ${CHILD_MARK} Disabling password authentication..." sed -ri 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  run_cmd "  ${CHILD_MARK} Restarting SSH service..." systemctl restart ssh
fi

# Firewall
printf "\n"
echo "Configuring firewall..."
run_cmd "  ${CHILD_MARK} Allowing port 22 (SSH)..." ufw allow 22
run_cmd "  ${CHILD_MARK} Allowing port 80 (HTTP)..." ufw allow 80
run_cmd "  ${CHILD_MARK} Allowing port 443 (HTTPS)..." ufw allow 443
run_cmd "  ${CHILD_MARK} Enabling UFW..." bash -c 'yes | ufw enable'

printf "\n"
echo -e "${GRN}Hardening complete. ✔${NC}"