#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib.sh"

init_script_logging "upgrade-0.4.4"

# Fix storage permissions/ownership after reset/provision changes
set_service_ids
storage_dir="$DATA_DIR/storage"

printf '\n'
run_cmd "${CHILD_MARK} Ensuring storage directory exists" install -d -m 0775 "$storage_dir"

if ! run_cmd --try "${CHILD_MARK} Fixing storage ownership" \
  bash -c "chown -R ${SERVICE_UID}:${SERVICE_GID} \"${storage_dir}\""; then
  printf "${YEL}Warning: Failed to update storage ownership. Run as root to fix.${NC}\n"
fi

if ! run_cmd --try "${CHILD_MARK} Fixing storage directory permissions" \
  bash -c "find \"${storage_dir}\" -type d -exec chmod 775 {} +"; then
  printf "${YEL}Warning: Failed to update storage directory permissions.${NC}\n"
fi

if ! run_cmd --try "${CHILD_MARK} Fixing storage file permissions" \
  bash -c "find \"${storage_dir}\" -type f -exec chmod 664 {} +"; then
  printf "${YEL}Warning: Failed to update storage file permissions.${NC}\n"
fi
