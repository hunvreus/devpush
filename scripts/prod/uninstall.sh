#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
exec 2> >(tee /tmp/uninstall_error.log >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Uninstall failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/uninstall_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage() {
  cat <<USG
Usage: uninstall.sh [--yes] [--no-telemetry] [--verbose]

Uninstall /dev/push from this server.

  --yes, -y         Non-interactive, proceed without prompts (keeps user and data by default)
  --no-telemetry    Do not send telemetry
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 1
}

yes_flag=0; telemetry=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) yes_flag=1; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

[[ $EUID -eq 0 ]] || { err "Run as root (sudo)."; exit 1; }

# Detect installation
app_dir=""
user="devpush"
version_ref=""
version_commit=""

if [[ -f /var/lib/devpush/version.json ]]; then
  version_ref=$(jq -r '.git_ref // empty' /var/lib/devpush/version.json 2>/dev/null || true)
  version_commit=$(jq -r '.git_commit // empty' /var/lib/devpush/version.json 2>/dev/null || true)
fi

# Find app directory
if [[ -d /home/devpush/devpush/.git ]]; then
  app_dir="/home/devpush/devpush"
elif [[ -d /opt/devpush/.git ]]; then
  app_dir="/opt/devpush"
fi

# Check if anything is installed
if [[ -z "$app_dir" && ! -f /var/lib/devpush/version.json && ! -d /srv/devpush ]]; then
  printf "\n"
  echo "No /dev/push installation detected."
  echo ""
  echo "Checked:"
  echo "  - /home/devpush/devpush"
  echo "  - /opt/devpush"
  echo "  - /var/lib/devpush/version.json"
  echo "  - /srv/devpush"
  exit 0
fi

# Show what was detected
printf "\n"
echo "Install detected:"
[[ -n "$app_dir" ]] && echo "- App directory: $app_dir"
[[ -d /srv/devpush ]] && echo "- Data directory: /srv/devpush/"
id -u "$user" >/dev/null 2>&1 && echo "- User: $user (home: /home/$user/)"
[[ -n "$version_ref" ]] && echo "- Version: $version_ref"

# Warning and confirmation
printf "\n"
if (( yes_flag == 0 )); then
  echo "${YEL}Warning:${NC} This will permanently remove /dev/push. Services will be stopped and containers/volumes deleted."
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
  run_cmd "Stopping services..." bash "$app_dir/scripts/prod/stop.sh" --app-dir "$app_dir" --down
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
if [[ -d /var/lib/devpush ]]; then
  set +e
  run_cmd_try "${CHILD_MARK} Removing metadata..." rm -rf /var/lib/devpush
  set -e
fi

# Send telemetry before removing version.json
if ((telemetry==1)) && [[ -f /var/lib/devpush/version.json ]]; then
  printf "\n"
  payload=$(jq -c --arg ev "uninstall" '. + {event: $ev}' /var/lib/devpush/version.json 2>/dev/null || echo "")
  if [[ -n "$payload" ]]; then
    run_cmd_try "Sending telemetry..." curl -fsSL -X POST -H 'Content-Type: application/json' -d "$payload" https://api.devpu.sh/v1/telemetry
  fi
fi

# Interactive: Remove data directory?
if (( yes_flag == 0 )) && [[ -d /srv/devpush ]]; then
  printf "\n"
  echo "${YEL}Warning:${NC} This will permanently delete all uploaded files, Traefik certificates, and configuration in /srv/devpush/"
  read -r -p "Remove data directory? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    set +e
    run_cmd_try "Removing data directory..." rm -rf /srv/devpush
    set -e
  else
    echo -e "${DIM}${CHILD_MARK} Data directory kept${NC}"
  fi
elif [[ -d /srv/devpush ]]; then
  echo ""
  echo -e "${DIM}${CHILD_MARK} Data directory kept (use rm -rf /srv/devpush to remove manually)${NC}"
fi

# Interactive: Remove user?
if (( yes_flag == 0 )) && id -u "$user" >/dev/null 2>&1; then
  printf "\n"
  echo "${YEL}Warning:${NC} This will delete the user and their home directory (/home/$user/), including any files not part of the application."
  read -r -p "Remove user '$user'? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    set +e
    run_cmd_try "Removing user '$user'..." userdel -r "$user"
    # Clean up sudoers file
    [[ -f /etc/sudoers.d/$user ]] && rm -f /etc/sudoers.d/$user
    set -e
  else
    echo -e "${DIM}${CHILD_MARK} User kept${NC}"
  fi
elif id -u "$user" >/dev/null 2>&1; then
  echo ""
  echo -e "${DIM}${CHILD_MARK} User '$user' kept (use 'userdel -r $user' to remove manually)${NC}"
fi

# Final summary
printf "\n"
echo -e "${GRN}Uninstall complete. ✔${NC}"
echo ""
echo "Removed:"
[[ -n "$app_dir" ]] && echo -e "${DIM}${CHILD_MARK} Application: $app_dir${NC}"
echo -e "${DIM}${CHILD_MARK} Docker containers and volumes${NC}"
[[ -n "$runner_images" ]] && echo -e "${DIM}${CHILD_MARK} Runner images: $image_count images${NC}"
echo -e "${DIM}${CHILD_MARK} Metadata: /var/lib/devpush/${NC}"

if [[ -d /srv/devpush ]] || id -u "$user" >/dev/null 2>&1; then
  echo ""
  echo "Kept (manual cleanup if needed):"
  [[ -d /srv/devpush ]] && echo -e "${DIM}${CHILD_MARK} Data: /srv/devpush/${NC}"
  id -u "$user" >/dev/null 2>&1 && echo -e "${DIM}${CHILD_MARK} User: $user${NC}"
fi

echo ""
echo "System packages not removed:"
echo -e "${DIM}${CHILD_MARK} Docker, git, jq, curl${NC}"
echo -e "${DIM}${CHILD_MARK} Security: UFW, fail2ban, SSH hardening${NC}"
echo ""
echo "To remove Docker:"
echo "  sudo apt-get remove --purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"

