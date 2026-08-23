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

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Docker Compose is required for local Postgres." >&2
  exit 1
}

step "Checking TypeScript"
pnpm --dir app typecheck

step "Checking lint"
pnpm --dir app lint

step "Running app tests"
pnpm --dir app test

step "Ensuring local Postgres"
compose -f deploy/compose.yml up -d

step "Resetting local schema"
(cd app && node <<'EOF'
const pg = require('pg')

const url = process.env.DATABASE_URL || 'postgres://devpush:devpush@localhost:7543/devpush'
const parsed = new URL(url)
const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
const isLocalPort = parsed.port === '7543'
const isLocalDb = parsed.pathname === '/devpush'

if (!isLocalHost || !isLocalPort || !isLocalDb) {
  throw new Error(`Refusing to reset non-local database: ${url}`)
}

async function main() {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  await client.query('drop schema if exists public cascade')
  await client.query('create schema public')
  await client.query('grant all on schema public to public')
  await client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
EOF
)

for attempt in {1..15}; do
  if (cd app && node_modules/.bin/drizzle-kit push --force); then
    break
  fi

  if [[ "$attempt" -eq 15 ]]; then
    echo "Timed out waiting for local Postgres." >&2
    exit 1
  fi

  sleep 2
done

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
