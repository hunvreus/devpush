#!/usr/bin/env bash
set -Eeuo pipefail

echo "Removing deprecated Loki Docker plugin (best effort)..."

if docker plugin inspect loki >/dev/null 2>&1; then
  docker plugin disable loki >/dev/null 2>&1 || true
  docker plugin rm -f loki >/dev/null 2>&1 || true
fi

echo "Ensuring Alloy data directory exists..."
sudo install -d -m 0755 /srv/devpush/alloy 2>/dev/null || true
