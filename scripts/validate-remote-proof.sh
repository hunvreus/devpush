#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Run the full devpush remote proof gate.

This chains:

1. Remote production config validation.
2. Production image validation.
3. Clean remote server validation with full proof enabled.

Required environment:
  DEVPUSH_BASE_URL         Public HTTPS control-plane URL
  DEVPUSH_REMOTE_HOST      SSH target, e.g. root@203.0.113.10
  DEVPUSH_INSTALL_COMMAND  Server install command copied from devpush
  DEVPUSH_PROJECT_URL      Public HTTPS app route after a GitHub-backed deploy

Optional environment:
  DEVPUSH_PROOF_ENV        Env file for config/image validation, default: deploy/.env.production

Example:
  DEVPUSH_BASE_URL=https://devpush.example.com \
  DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
  DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
  DEVPUSH_PROJECT_URL=https://my-app.example.com \
  pnpm validate:remote:proof
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    echo >&2
    usage >&2
    exit 2
  fi
}

step() {
  printf '\n==> %s\n' "$1"
}

required DEVPUSH_BASE_URL
required DEVPUSH_REMOTE_HOST
required DEVPUSH_INSTALL_COMMAND
required DEVPUSH_PROJECT_URL

proof_env="${DEVPUSH_PROOF_ENV:-deploy/.env.production}"

if [[ ! -f "$proof_env" ]]; then
  echo "Remote proof env file not found: $proof_env" >&2
  exit 2
fi

node - "$proof_env" "$DEVPUSH_BASE_URL" <<'EOF'
const { readFileSync } = require('node:fs')
const { parseEnv } = require('node:util')

const [, , envPath, expectedBaseUrl] = process.argv
const fileEnv = parseEnv(readFileSync(envPath, 'utf8'))
const env = { ...fileEnv, ...process.env }
const configuredBaseUrl = env.DEVPUSH_BASE_URL

if (!configuredBaseUrl) {
  console.error(`DEVPUSH_BASE_URL is missing from ${envPath}`)
  process.exit(2)
}

let configuredOrigin
let expectedOrigin
try {
  configuredOrigin = new URL(configuredBaseUrl).origin
} catch {
  console.error(`DEVPUSH_BASE_URL is not a valid URL in ${envPath}`)
  process.exit(2)
}
try {
  expectedOrigin = new URL(expectedBaseUrl).origin
} catch {
  console.error('DEVPUSH_BASE_URL is not a valid URL.')
  process.exit(2)
}

if (configuredOrigin !== expectedOrigin) {
  console.error(`Configured DEVPUSH_BASE_URL origin (${configuredOrigin}) must match the remote proof origin (${expectedOrigin}).`)
  process.exit(2)
}

EOF

step "Validating remote production config"
pnpm validate:config -- --env "$proof_env" --remote

step "Validating production image"
DEVPUSH_PRODUCTION_ENV="$proof_env" pnpm validate:production

step "Validating remote server and deployed route"
DEVPUSH_FULL_PROOF=1 pnpm validate:remote
