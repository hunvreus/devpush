#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Validate devpush locally before attempting a real remote server run.

The default run checks TypeScript, linting, app tests, the control-plane deploy
lifecycle smoke, Go agent tests, smoke-mode config validation, and the real
local Docker/Traefik agent smoke.

Optional environment:
  DEVPUSH_SKIP_DOCKER_SMOKE=1  Skip the real Docker/Traefik agent smoke.

Example:
  pnpm validate:local
  DEVPUSH_SKIP_DOCKER_SMOKE=1 pnpm validate:local
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

step() {
  printf '\n==> %s\n' "$1"
}

step "Checking TypeScript"
pnpm --dir app typecheck

step "Checking lint"
pnpm --dir app lint

step "Running app tests"
pnpm --dir app test

step "Preparing isolated SQLite stores"
validation_dir="$(mktemp -d "${TMPDIR:-/tmp}/devpush-validation.XXXXXX")"
trap 'rm -rf "$validation_dir"' EXIT
export DEVPUSH_DATABASE_PATH="$validation_dir/devpush.sqlite"
export DEVPUSH_LOG_DATABASE_PATH="$validation_dir/logs.sqlite"
pnpm --dir app db:migrate

step "Running database integration tests"
pnpm test:integration

step "Running control-plane deploy lifecycle smoke"
pnpm smoke:deploy

step "Running agent tests"
pnpm agent:test

step "Validating local config"
pnpm validate:config -- --smoke

if [[ "${DEVPUSH_SKIP_DOCKER_SMOKE:-}" == "1" ]]; then
  step "Skipping Docker/Traefik agent smoke"
else
  step "Running Docker/Traefik agent smoke"
  pnpm smoke:agent
fi

cat <<'EOF'

Local validation passed.

This does not prove the remote VPS flow. The remaining proof is:
  1. Deploy the control plane with public HTTPS.
  2. Add a server and run its generated install command on a clean VPS.
  3. Create a GitHub-backed Compose project.
  4. Trigger a deployment.
  5. Run pnpm validate:remote:proof with DEVPUSH_PROJECT_URL set.
EOF
