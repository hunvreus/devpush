#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Validate the production control-plane image before a remote VPS run.

This checks the production Compose file, builds the app image, and verifies that
the runtime image contains:

- the bundled Linux devpush-agent binary used by the server installer
- the explicit migration runner and SQL migrations
- the built TanStack Start server entrypoint

Optional environment:
  DEVPUSH_PRODUCTION_IMAGE  Image tag to build, default: devpush-app:local
  DEVPUSH_PRODUCTION_ENV    Env file for Compose config, default: deploy/.env.production.example

Example:
  pnpm validate:production
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

image="${DEVPUSH_PRODUCTION_IMAGE:-devpush-app:local}"
env_file="${DEVPUSH_PRODUCTION_ENV:-deploy/.env.production.example}"

step() {
  printf '\n==> %s\n' "$1"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Docker Compose is required." >&2
  exit 1
}

step "Checking production Compose config"
compose --env-file "$env_file" -f deploy/compose.production.yml config >/dev/null

step "Building production app image"
docker build -f deploy/Dockerfile.app -t "$image" .

step "Checking production runtime image"
docker run --rm "$image" sh -lc '
  set -euo pipefail
  test -x /repo/bin/devpush-agent-linux-amd64
  test -x /repo/bin/devpush-agent-linux-arm64
  /repo/bin/devpush-agent-linux-amd64 --help >/dev/null || true
  /repo/bin/devpush-agent-linux-arm64 --help >/dev/null || true
  test -f /repo/app/.output/server/index.mjs
  test -f /repo/app/scripts/migrate.ts
  test -f /repo/app/scripts/sync-agent-binaries.ts
  test -f /repo/app/src/server/db/migrations/meta/_journal.json
  pnpm --dir app exec tsx --version >/dev/null
'

cat <<EOF

Production image validation passed.

Image: $image
EOF
