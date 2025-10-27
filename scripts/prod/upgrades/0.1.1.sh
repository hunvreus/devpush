#!/usr/bin/env bash
set -Eeuo pipefail

echo "Fixing /var/lib/devpush permissions (root ownership)..."

if [[ -d /var/lib/devpush ]]; then
  sudo chown -R root:root /var/lib/devpush 2>/dev/null || true
  sudo chmod 0755 /var/lib/devpush 2>/dev/null || true
  if [[ -f /var/lib/devpush/version.json ]]; then
    sudo chmod 0644 /var/lib/devpush/version.json 2>/dev/null || true
  fi
  if [[ -f /var/lib/devpush/config.json ]]; then
    sudo chmod 0644 /var/lib/devpush/config.json 2>/dev/null || true
  fi
fi

exit 0