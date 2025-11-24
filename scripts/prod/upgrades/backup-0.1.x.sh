#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# One-off backup script for pre-0.2.0 installs (old layout under /srv/devpush)
# Captures /srv/devpush and the app checkout under /home/devpush/devpush if present.

timestamp="$(date +%Y%m%d%H%M%S)"
backup_root="/var/backups/devpush"
mkdir -p "$backup_root"

data_src="/srv/devpush"
app_src="/home/devpush/devpush"

archive="$backup_root/devpush-old-${timestamp}.tar.gz"

echo "Creating backup at: $archive"

# Stop running stack if possible (best-effort)
if command -v docker-compose >/dev/null 2>&1 && [[ -f "$app_src/docker-compose.yml" ]]; then
  echo "Stopping running stack (best effort)..."
  docker-compose -p devpush -f "$app_src/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
fi

tar_args=()
[[ -d "$data_src" ]] && tar_args+=("-C" "/srv" "devpush")
[[ -d "$app_src" ]] && tar_args+=("-C" "/home/devpush" "devpush")

if ((${#tar_args[@]}==0)); then
  echo "Nothing to back up (no /srv/devpush or /home/devpush/devpush)."
  exit 0
fi

tar -czf "$archive" "${tar_args[@]}"

echo "Backup created:"
echo "  $archive"
