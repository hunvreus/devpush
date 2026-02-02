#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

[[ $EUID -eq 0 ]] || { printf "This script must be run as root (sudo).\n" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "uninstall"

usage() {
  cat <<USG
Usage: uninstall.sh [--yes] [--skip-backup] [--no-telemetry] [--verbose]

Uninstall /dev/push from this server.

  --yes, -y         Non-interactive; skip prompts and remove data/logs if they exist
  --skip-backup     Skip creating a backup before uninstalling
  --no-telemetry    Do not send telemetry
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

# Parse CLI flags
yes_flag=0; skip_backup=0; telemetry=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) yes_flag=1; shift ;;
    --skip-backup) skip_backup=1; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ "$ENVIRONMENT" == "development" ]]; then
  err "This script is for production only. For development, simply stop the stack (scripts/stop.sh), run the cleanup script (scripts/clean.sh --remove-all) and delete the code directory. More information: https://devpu.sh/docs/installation/#development"
  exit 1
fi

cwd="$(pwd)"
if [[ "$cwd" == "$APP_DIR"* ]] || [[ "$cwd" == "$DATA_DIR"* ]]; then
  err "Cannot run from $cwd (will be deleted). Run from a safe directory (e.g., /tmp or ~root)."
  exit 1
fi

if [[ "$(whoami)" == "devpush" ]] || [[ "${SUDO_USER:-}" == "devpush" ]]; then
  err "Cannot run as user 'devpush' (user will be deleted). Run as root or another user."
  exit 1
fi

cleanup_systemd_unit() {
  systemctl stop devpush.service || true
  systemctl disable devpush.service || true
  rm -f /etc/systemd/system/devpush.service || true
  systemctl reset-failed devpush.service || true
  systemctl daemon-reload || true
  return 0
}

# Detect installation and save telemetry data
user="devpush"
version_ref=""
telemetry_payload=""
user_home="$(getent passwd "$user" | cut -d: -f6 2>/dev/null || true)"
[[ -n "$user_home" ]] || user_home="$DATA_DIR"

if [[ -f $VERSION_FILE ]]; then
  version_ref=$(json_get git_ref "$VERSION_FILE" "")
  if ((telemetry==1)); then
    telemetry_payload=$(jq -c --arg ev "uninstall" '. + {event: $ev}' "$VERSION_FILE" 2>/dev/null || printf '')
  fi
fi

# Check if anything is installed
if [[ ! -f $VERSION_FILE && ! -d $APP_DIR/.git ]]; then
  printf '\n'
  printf "No installation detected.\n"
  printf '\n'
  printf "Checked:\n"
  printf "  - %s/version.json\n" "$DATA_DIR"
  printf "  - %s/.git\n" "$APP_DIR"
  exit 0
fi

# Show what was detected
printf '\n'
printf "Installation detected:\n"
printf "  - App directory: %s\n" "$APP_DIR"
printf "  - Data directory: %s\n" "$DATA_DIR"
[[ -d "$LOG_DIR" ]] && printf "  - Log directory: %s\n" "$LOG_DIR"
if id -u "$user" >/dev/null 2>&1; then
  printf "  - User: %s (home: %s)\n" "$user" "$user_home"
fi
[[ -n "$version_ref" ]] && printf "  - Version (ref): %s\n" "$version_ref"

# Create backup before uninstalling
if (( skip_backup == 0 )); then
  printf '\n'
  if (( yes_flag == 0 )); then
    read -r -p "Create a backup before uninstalling? [Y/n] " ans
    if [[ -z "$ans" || "$ans" =~ ^[Yy]([Ee][Ss])?$ ]]; then
      run_cmd "Creating backup" bash "$SCRIPT_DIR/backup.sh"
    fi
  else
    run_cmd "Creating backup" bash "$SCRIPT_DIR/backup.sh"
  fi
fi

# Warning/confirmation
if (( yes_flag == 0 )); then
  printf '\n'
  printf "${YEL}This will permanently remove /dev/push. Services will be stopped and files deleted.${NC}\n"
  printf '\n'
  read -r -p "Proceed with uninstall? [y/N] " ans
  if [[ ! "$ans" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    printf "Aborted.\n"
    exit 0
  fi
fi

# Stopping the stack
printf '\n'
run_cmd --try "Stopping stack" bash "$SCRIPT_DIR/stop.sh" --hard

# Remove systemd unit
printf '\n'
run_cmd "Cleaning up systemd unit" cleanup_systemd_unit

# Remove Docker resources
printf '\n'
printf "Removing Docker resources\n"

# Remove Docker containers
compose_containers="$(docker ps -a --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null || true)"
runner_containers="$(docker ps -a --filter "label=devpush.deployment_id" -q 2>/dev/null || true)"
containers="$(printf "%s\n%s\n" "$compose_containers" "$runner_containers" | grep -v '^\s*$' | sort -u || true)"
if [[ -n "$containers" ]]; then
  container_count=$(printf '%s\n' "$containers" | wc -l | tr -d ' ')
  run_cmd --try "${CHILD_MARK} Removing containers ($container_count found)" docker rm -f $containers
fi

# Remove Docker images
compose_images="$(docker images --filter "reference=devpush*" -q 2>/dev/null || true)"
legacy_runner_images="$(docker images --filter "reference=runner-*" -q 2>/dev/null || true)"
runner_images="$(docker images --filter "reference=ghcr.io/devpushhq/runner-*" -q 2>/dev/null || true)"
override_images=""
if [[ -f "$DATA_DIR/registry/overrides.json" ]]; then
  override_refs="$(
    jq -r '.. | objects | .image? // empty' "$DATA_DIR/registry/overrides.json" 2>/dev/null \
      | grep -v '^ghcr.io/devpushhq/runner-' \
      | sort -u || true
  )"
  if [[ -n "$override_refs" ]]; then
    while IFS= read -r ref; do
      [[ -n "$ref" ]] || continue
      ref_images="$(docker images --filter "reference=$ref" -q 2>/dev/null || true)"
      if [[ -n "$ref_images" ]]; then
        override_images="$(printf "%s\n%s" "$override_images" "$ref_images")"
      fi
    done <<< "$override_refs"
  fi
fi
images="$(printf "%s\n%s\n%s\n%s\n" "$compose_images" "$legacy_runner_images" "$runner_images" "$override_images" | grep -v '^\s*$' | sort -u || true)"
if [[ -n "$images" ]]; then
  image_count=$(printf '%s\n' "$images" | wc -l | tr -d ' ')
  run_cmd --try "${CHILD_MARK} Removing images ($image_count found)" docker rmi -f $images
else
  printf "%s Removing Docker images (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
fi

# Remove Docker networks
networks=$(docker network ls --filter "name=devpush" -q 2>/dev/null || true)
if [[ -n "$networks" ]]; then
  network_count=$(printf '%s\n' "$networks" | wc -l | tr -d ' ')
  run_cmd --try "${CHILD_MARK} Removing networks ($network_count found)" docker network rm $networks
else
  printf "%s Removing Docker networks (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
fi

# Remove Docker volumes
volumes=$(docker volume ls --filter "name=devpush" -q 2>/dev/null || true)
if [[ -n "$volumes" ]]; then
  volume_count=$(printf '%s\n' "$volumes" | wc -l | tr -d ' ')
  run_cmd --try "${CHILD_MARK} Removing volumes ($volume_count found)" docker volume rm $volumes
else
  printf "%s Removing Docker volumes (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
fi

# Remove data directory
if [[ -d $DATA_DIR ]]; then
  printf '\n'
  run_cmd --try "Removing data directory" rm -rf "$DATA_DIR"
fi

# Remove log directory
if [[ -d "$LOG_DIR" ]]; then
  printf '\n'
  run_cmd --try "Removing log directory" rm -rf "$LOG_DIR"
fi

# Remove app directory
if [[ -n "$APP_DIR" && -d "$APP_DIR" ]]; then
  printf '\n'
  run_cmd --try "Removing app directory" rm -rf "$APP_DIR"
fi

# Remove user
if id -u "$user" >/dev/null 2>&1; then
  printf '\n'
  if run_cmd --try "Removing user '$user'" userdel -r "$user"; then
    [[ -f /etc/sudoers.d/$user ]] && rm -f /etc/sudoers.d/$user
  else
    printf "${YEL}Could not remove user (may have active processes). Run 'userdel -r %s' manually after logout.${NC}\n" "$user"
  fi
fi

# Send telemetry
if ((telemetry==1)) && [[ -n "$telemetry_payload" ]]; then
  printf '\n'
  if ! run_cmd --try "Sending telemetry" send_telemetry uninstall "$telemetry_payload"; then
    printf "  ${DIM}${CHILD_MARK} Telemetry failed (non-fatal). Continuing uninstall.${NC}\n"
  fi
fi

# Final summary
printf '\n'
printf "${GRN}Uninstall complete. ✔${NC}\n"
printf '\n'
printf "Backup files were preserved (%s).\n" "$BACKUP_DIR"
printf '\n'
printf "System packages not removed:\n"
printf "  - Docker, git, jq, curl\n"
printf "  - Security: UFW, fail2ban, SSH hardening\n"
