#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Validate the production control-plane image before a remote VPS run.

This checks the production Compose file, builds the app image, and verifies that
the runtime image contains:

- the bundled Linux devpush-agent binary used by the server installer
- drizzle-kit, required by the current MVP startup command
- the built TanStack Start server entrypoint

Optional environment:
  DEVPUSH_PRODUCTION_IMAGE  Image tag to build, default: devpush-mvp-app:local
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

image="${DEVPUSH_PRODUCTION_IMAGE:-devpush-mvp-app:local}"
env_file="${DEVPUSH_PRODUCTION_ENV:-deploy/.env.production.example}"

step() {
  printf '\n==> %s\n' "$1"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Docker Compose is required. Install docker compose or docker-compose." >&2
    exit 1
  fi
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
  pnpm --dir app exec drizzle-kit --version >/dev/null
'

cat <<EOF

Production image validation passed.

Image: $image
EOF
