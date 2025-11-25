#!/usr/bin/env bash
set -Eeuo pipefail

DATA_DIR="/var/lib/devpush"

printf "Fixing %s permissions (root ownership)...\n" "$DATA_DIR"

if [[ -d $DATA_DIR ]]; then
  sudo chown -R root:root $DATA_DIR 2>/dev/null || true
  sudo chmod 0755 $DATA_DIR 2>/dev/null || true
  if [[ -f $DATA_DIR/version.json ]]; then
    sudo chmod 0644 $DATA_DIR/version.json 2>/dev/null || true
  fi
  if [[ -f $DATA_DIR/config.json ]]; then
    sudo chmod 0644 $DATA_DIR/config.json 2>/dev/null || true
  fi
fi

exit 0