#!/usr/bin/env bash
set -Eeuo pipefail

printf "Removing deprecated Loki Docker plugin (best effort)...\n"

if docker plugin inspect loki >/dev/null 2>&1; then
  docker plugin disable loki >/dev/null 2>&1 || true
  docker plugin rm -f loki >/dev/null 2>&1 || true
fi

printf "Ensuring Alloy data directory exists...\n"
sudo install -d -m 0755 /srv/devpush/alloy 2>/dev/null || true
