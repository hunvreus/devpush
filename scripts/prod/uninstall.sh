#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
SCRIPT_ERR_LOG="/tmp/uninstall_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

DATA_DIR="/var/lib/devpush"

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Uninstall failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || echo "No error details captured"; exit $s' ERR

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
if [[ "$cwd" == /home/devpush/* ]] || [[ "$cwd" == /opt/devpush/* ]] || [[ "$cwd" == $DATA_DIR/* ]] || [[ "$cwd" == /srv/devpush/* ]]; then
  err "Cannot run from $cwd (will be deleted). Run from a safe directory (e.g., /tmp or ~root)."
  exit 1
fi

# Guard: check if logged in as user that will be deleted
if [[ "$(whoami)" == "devpush" ]] || [[ "${SUDO_USER:-}" == "devpush" ]]; then
  err "Cannot run as user 'devpush' (user will be deleted). Run as root or another user."
  exit 1
fi

# Detect installation and save telemetry data early
app_dir=""
user="devpush"
version_ref=""
telemetry_payload=""

if [[ -f $DATA_DIR/version.json ]]; then
  version_ref=$(jq -r '.git_ref // empty' $DATA_DIR/version.json 2>/dev/null || true)
  if ((telemetry==1)); then
    telemetry_payload=$(jq -c --arg ev "uninstall" '. + {event: $ev}' $DATA_DIR/version.json 2>/dev/null || echo "")
  fi
fi

# Find app directory
if [[ -d /home/devpush/devpush/.git ]]; then
  app_dir="/home/devpush/devpush"
elif [[ -d /opt/devpush/.git ]]; then
  app_dir="/opt/devpush"
fi

# Check if anything is installed
if [[ -z "$app_dir" && ! -f $DATA_DIR/version.json && ! -d /srv/devpush ]]; then
  printf "\n"
  echo "No /dev/push installation detected."
  echo ""
  echo "Checked:"
  echo "  - /home/devpush/devpush"
  echo "  - /opt/devpush"
  echo "  - $DATA_DIR/version.json"
  echo "  - /srv/devpush"
  exit 0
fi

# Show what was detected
printf "\n"
echo "Install detected:"
[[ -n "$app_dir" ]] && echo "  - App directory: $app_dir"
[[ -d /srv/devpush ]] && echo "  - Data directory: /srv/devpush/"
id -u "$user" >/dev/null 2>&1 && echo "  - User: $user (home: /home/$user/)"
[[ -n "$version_ref" ]] && echo "  - Version (ref): $version_ref"

# Warning and confirmation
if (( yes_flag == 0 )); then
  printf "\n"
  echo "${YEL}Warning:${NC} This will permanently remove /dev/push. Services will be stopped and containers/volumes deleted."
  printf "\n"
  read -r -p "Proceed with uninstall? [y/N] " ans
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
else
  echo "${YEL}Warning:${NC} This will permanently remove /dev/push. Services will be stopped and containers/volumes deleted."
fi

# Stop services
printf "\n"
if [[ -n "$app_dir" && -f "$app_dir/docker-compose.yml" ]]; then
  run_cmd "Stopping services..." bash "$app_dir/scripts/prod/stop.sh" --down
else
  echo "Stopping services... ${YEL}⊘${NC}"
  echo -e "${DIM}${CHILD_MARK} No docker-compose.yml found${NC}"
fi

# Remove application
printf "\n"
echo "Removing application..."

if [[ -n "$app_dir" && -d "$app_dir" ]]; then
  set +e
  run_cmd_try "${CHILD_MARK} Removing app directory..." rm -rf "$app_dir"
  set -e
fi

# Remove runner images
set +e
runner_images=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^runner-' || true)
if [[ -n "$runner_images" ]]; then
  image_count=$(echo "$runner_images" | wc -l | tr -d ' ')
  run_cmd_try "${CHILD_MARK} Removing runner images ($image_count found)..." bash -c "echo '$runner_images' | xargs docker rmi -f"
else
  echo "${CHILD_MARK} Removing runner images... ${YEL}⊘${NC}"
  echo -e "${DIM}${CHILD_MARK} No runner images found${NC}"
fi
set -e

# Remove metadata
if [[ -d $DATA_DIR ]]; then
  set +e
  run_cmd_try "${CHILD_MARK} Removing metadata..." rm -rf $DATA_DIR
  set -e
fi

# Interactive: Remove data directory?
if (( yes_flag == 0 )) && [[ -d /srv/devpush ]]; then
  printf "\n"
  read -r -p "Remove data directory (/srv/devpush/)? This will delete all uploaded files, certificates, and config. [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    set +e
    echo ""
    run_cmd_try "Removing data directory..." rm -rf /srv/devpush
    set -e
  fi
elif [[ -d /srv/devpush ]]; then
  echo ""
  echo -e "${DIM}${CHILD_MARK} Data directory kept (use rm -rf /srv/devpush to remove manually)${NC}"
fi

# Interactive: Remove user?
if (( yes_flag == 0 )) && id -u "$user" >/dev/null 2>&1; then
  printf "\n"
  read -r -p "Remove user '$user' and home directory? This will delete all files in /home/$user/. [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    echo ""
    set +eE
    trap - ERR
    if run_cmd_try "Removing user '$user'..." userdel -r "$user"; then
      # Clean up sudoers file
      [[ -f /etc/sudoers.d/$user ]] && rm -f /etc/sudoers.d/$user
    else
      echo -e "${YEL}Warning:${NC} Could not remove user (may have active processes). Run 'userdel -r $user' manually after logout."
    fi
    trap 's=$?; err "Uninstall failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/uninstall_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR
    set -eE
  fi
elif id -u "$user" >/dev/null 2>&1; then
  echo ""
  echo -e "${DIM}${CHILD_MARK} User '$user' kept (use 'userdel -r $user' to remove manually)${NC}"
fi

# Send telemetry at the end (using saved payload)
if ((telemetry==1)) && [[ -n "$telemetry_payload" ]]; then
  printf "\n"
  send_telemetry uninstall "$telemetry_payload" || true
fi

# Final summary
printf "\n"
echo -e "${GRN}Uninstall complete. ✔${NC}"
echo ""
echo "Removed:"
[[ -n "$app_dir" ]] && echo "  - Application: $app_dir"
echo "  - Docker containers and volumes"
[[ -n "$runner_images" ]] && echo "  - Runner images: $image_count images"
echo "  - Metadata: $DATA_DIR/"

if [[ -d /srv/devpush ]] || id -u "$user" >/dev/null 2>&1; then
  echo ""
  echo "Kept (manual cleanup if needed):"
  [[ -d /srv/devpush ]] && echo "  - Data: /srv/devpush/"
  id -u "$user" >/dev/null 2>&1 && echo "  - User: $user"
fi

echo ""
echo "System packages not removed:"
echo "  - Docker, git, jq, curl"
echo "  - Security: UFW, fail2ban, SSH hardening"

