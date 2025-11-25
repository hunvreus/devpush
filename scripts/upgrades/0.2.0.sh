#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="/opt/devpush"
DATA_DIR="/var/lib/devpush"
LEGACY_DIR="/srv/devpush"
USER_NAME="devpush"

log(){ printf "%s\n" "$*"; }

# Skip if no legacy directory
if [[ ! -d "$LEGACY_DIR" ]]; then
  log "Legacy directory not found at $LEGACY_DIR. Nothing to migrate."
  exit 0
fi

# Ensure target dir exists
if [[ ! -d "$DATA_DIR" ]]; then
  sudo install -d -o "$USER_NAME" -g "$USER_NAME" -m 0750 "$DATA_DIR"
fi

log "Stopping stack for migration..."
sudo docker compose -p devpush -f "$APP_DIR/compose/run.yml" -f "$APP_DIR/compose/run.override.yml" down --remove-orphans || true
sudo docker compose -p devpush -f "$APP_DIR/compose/setup.yml" down --remove-orphans || true

log "Migrating data from $LEGACY_DIR to $DATA_DIR..."
if command -v rsync >/dev/null 2>&1; then
  sudo rsync -a "$LEGACY_DIR"/ "$DATA_DIR"/
else
  sudo cp -a "$LEGACY_DIR"/. "$DATA_DIR"/
fi

log "Fixing ownership and permissions..."
sudo chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR"
sudo find "$DATA_DIR" -type d -exec chmod 0750 {} +
sudo find "$DATA_DIR" -type f -exec chmod 0640 {} +
sudo chmod 0600 "$DATA_DIR/traefik/acme.json" 2>/dev/null || true

backup_target="${LEGACY_DIR}.backup-$(date +%Y%m%d%H%M%S)"
log "Renaming legacy directory to $backup_target..."
sudo mv "$LEGACY_DIR" "$backup_target"

log "Migration complete."
