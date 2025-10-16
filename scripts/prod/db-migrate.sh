#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

source "$(dirname "$0")/lib.sh"

# usage
usage(){
  cat <<USG
Usage: db-migrate.sh [--app-dir <path>] [--env-file <path>] [--timeout <sec>]

Run Alembic database migrations in production (waits for DB/app readiness).

  --app-dir PATH    App directory (default: $PWD)
  --env-file PATH   Path to .env (default: ./\.env)
  --timeout SEC     Max wait for health (default: 120)
USG
  exit 0
}

app_dir="${APP_DIR:-$(pwd)}"; envf=".env"; timeout=120
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) app_dir="$2"; shift 2 ;;
    --env-file) envf="$2"; shift 2 ;;
    --timeout) timeout="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

# Validate environment variables
 validate_core_env "$envf"

# Wait for database
info "Waiting for database..."
for i in $(seq 1 $((timeout/5))); do
  if docker compose -p devpush exec -T pgsql pg_isready -U "${POSTGRES_USER:-devpush-app}" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

if ! docker compose -p devpush exec -T pgsql pg_isready -U "${POSTGRES_USER:-devpush-app}" >/dev/null 2>&1; then
  err "Database not ready"
  exit 1
fi

# Wait for app container
info "Waiting for app container..."
for i in $(seq 1 $((timeout/5))); do
  running=$(docker ps --filter "name=devpush-app" -q | wc -l | tr -d ' ')
  if [ "$running" != "0" ]; then break; fi
  sleep 5
done

# Run database migrations
info "Running migrations..."
docker compose -p devpush exec -T app uv run alembic upgrade head
ok "Migrations applied."