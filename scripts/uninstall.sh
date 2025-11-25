#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
SCRIPT_ERR_LOG="/tmp/uninstall_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "Uninstall failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage() {
  cat <<USG
Usage: uninstall.sh [--yes] [--no-telemetry] [--verbose]

Uninstall /dev/push from this server.

  --yes, -y         Non-interactive, proceed without prompts (keeps user and data by default)
  --no-telemetry    Do not send telemetry
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

yes_flag=0; telemetry=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) yes_flag=1; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { err "Run as root (sudo)."; exit 1; }

# Guard: prevent running from directories that will be deleted
cwd="$(pwd)"
if [[ "$cwd" == $APP_DIR* ]] || [[ "$cwd" == $DATA_DIR* ]]; then
  err "Cannot run from $cwd (will be deleted). Run from a safe directory (e.g., /tmp or ~root)."
  exit 1
fi

# Guard: check if logged in as user that will be deleted
if [[ "$(whoami)" == "devpush" ]] || [[ "${SUDO_USER:-}" == "devpush" ]]; then
  err "Cannot run as user 'devpush' (user will be deleted). Run as root or another user."
  exit 1
fi

# Detect installation and save telemetry data early
user="devpush"
version_ref=""
telemetry_payload=""

if [[ -f $DATA_DIR/version.json ]]; then
  version_ref=$(jq -r '.git_ref // empty' $DATA_DIR/version.json 2>/dev/null || true)
  if ((telemetry==1)); then
    telemetry_payload=$(jq -c --arg ev "uninstall" '. + {event: $ev}' $DATA_DIR/version.json 2>/dev/null || printf '')
  fi
fi

# Check if anything is installed
if [[ ! -f $DATA_DIR/version.json && ! -d $APP_DIR/.git ]]; then
  printf '\n'
  printf "No /dev/push installation detected.\n"
  printf '\n'
  printf "Checked:\n"
  printf "  - %s/version.json\n" "$DATA_DIR"
  printf "  - %s/.git\n" "$APP_DIR"
  exit 0
fi

# Show what was detected
printf '\n'
printf "Install detected:\n"
printf "  - App directory: %s\n" "$APP_DIR"
printf "  - Data directory: %s\n" "$DATA_DIR"
id -u "$user" >/dev/null 2>&1 && printf "  - User: %s (home: %s/)\n" "$user" "$DATA_DIR"
[[ -n "$version_ref" ]] && printf "  - Version (ref): %s\n" "$version_ref"

# Warning and confirmation
if (( yes_flag == 0 )); then
  printf '\n'
  printf "${YEL}Warning:${NC} This will permanently remove /dev/push. Services will be stopped and containers/volumes deleted.\n"
  printf '\n'
  read -r -p "Proceed with uninstall? [y/N] " ans
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    printf "Aborted.\n"
    exit 0
  fi
else
  printf "${YEL}Warning:${NC} This will permanently remove /dev/push. Services will be stopped and containers/volumes deleted.\n"
fi

# Stop services
printf '\n'
if systemctl list-unit-files | grep -q '^devpush.service'; then
  run_cmd "Stopping services (systemd)..." systemctl stop devpush.service || true
elif [[ -f "$APP_DIR/compose/run.yml" ]]; then
  run_cmd "Stopping services..." bash "$SCRIPT_DIR/stop.sh" --down
else
  printf "Stopping services... ${YEL}⊘${NC}\n"
  printf "${DIM}%s No compose/run.yml found${NC}\n" "$CHILD_MARK"
fi

# Remove application
printf '\n'
printf "Removing application...\n"

if [[ -n "$APP_DIR" && -d "$APP_DIR" ]]; then
  set +e
  run_cmd_try "${CHILD_MARK} Removing app directory..." rm -rf "$APP_DIR"
  set -e
fi

# Remove runner images
set +e
runner_images=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^runner-' || true)
if [[ -n "$runner_images" ]]; then
  image_count=$(printf '%s\n' "$runner_images" | wc -l | tr -d ' ')
  run_cmd_try "${CHILD_MARK} Removing runner images ($image_count found)..." bash -c 'printf "%s\n" "$1" | xargs docker rmi -f' _ "$runner_images"
else
  printf "%s Removing runner images... ${YEL}⊘${NC}\n" "$CHILD_MARK"
  printf "${DIM}%s No runner images found${NC}\n" "$CHILD_MARK"
fi
set -e

# Remove data directory (prompt unless --yes)
data_removed=0
if [[ -d $DATA_DIR ]]; then
  if (( yes_flag == 1 )); then
    set +e
    run_cmd_try "Removing data directory..." rm -rf "$DATA_DIR"
    set -e
    data_removed=1
  else
    printf '\n'
    read -r -p "Remove data directory ($DATA_DIR/)? This will delete all uploaded files, certificates, and config. [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      set +e
      printf '\n'
      run_cmd_try "Removing data directory..." rm -rf "$DATA_DIR"
      set -e
      data_removed=1
    else
      printf '\n'
      printf "${DIM}%s Data directory kept (use rm -rf %s to remove manually)${NC}\n" "$CHILD_MARK" "$DATA_DIR"
    fi
  fi
fi

# Interactive: Remove user?
if (( yes_flag == 0 )) && id -u "$user" >/dev/null 2>&1; then
  printf '\n'
  read -r -p "Remove user '$user' and home directory? This will delete all files in /home/$user/. [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    printf '\n'
    set +eE
    trap - ERR
    if run_cmd_try "Removing user '$user'..." userdel -r "$user"; then
      # Clean up sudoers file
      [[ -f /etc/sudoers.d/$user ]] && rm -f /etc/sudoers.d/$user
    else
      printf "${YEL}Warning:${NC} Could not remove user (may have active processes). Run 'userdel -r %s' manually after logout.\n" "$user"
    fi
    trap 's=$?; err "Uninstall failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat /tmp/uninstall_error.log 2>/dev/null || printf "No error details captured\n"; exit $s' ERR
    set -eE
  fi
elif id -u "$user" >/dev/null 2>&1; then
  printf '\n'
  printf "${DIM}%s User '%s' kept (use 'userdel -r %s' to remove manually)${NC}\n" "$CHILD_MARK" "$user" "$user"
fi

# Send telemetry at the end (using saved payload)
if ((telemetry==1)) && [[ -n "$telemetry_payload" ]]; then
  printf '\n'
  send_telemetry uninstall "$telemetry_payload" || true
fi

# Final summary
printf '\n'
printf "${GRN}Uninstall complete. ✔${NC}\n"
printf '\n'
printf "Removed:\n"
printf "  - Application: %s\n" "$APP_DIR"
printf "  - Docker containers and volumes\n"
[[ -n "$runner_images" ]] && printf "  - Runner images: %s images\n" "$image_count"
(( data_removed == 1 )) && printf "  - Data: %s/\n" "$DATA_DIR"

if [[ -d $DATA_DIR ]] || (( data_removed == 0 && yes_flag == 1 )) || id -u "$user" >/dev/null 2>&1; then
  printf '\n'
  printf "Kept (manual cleanup if needed):\n"
  [[ -d $DATA_DIR ]] && printf "  - Data: %s/\n" "$DATA_DIR"
  id -u "$user" >/dev/null 2>&1 && printf "  - User: %s\n" "$user"
fi

printf '\n'
printf "System packages not removed:\n"
printf "  - Docker, git, jq, curl\n"
printf "  - Security: UFW, fail2ban, SSH hardening\n"

# Remove systemd unit if present
if systemctl list-unit-files | grep -q '^devpush.service'; then
  printf '\n'
  run_cmd_try "${CHILD_MARK} Disabling systemd unit..." systemctl disable devpush.service
  run_cmd_try "${CHILD_MARK} Removing systemd unit..." rm -f /etc/systemd/system/devpush.service
  run_cmd_try "${CHILD_MARK} Reloading systemd..." systemctl daemon-reload
fi
