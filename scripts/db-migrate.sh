#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ERR_LOG="/tmp/db-migrate_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "DB migrate failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage() {
  cat <<USG
Usage: db-migrate.sh [--timeout <sec>] [-h|--help]

Run Alembic upgrades after ensuring Postgres is ready.

  --timeout <sec>    Max seconds to wait for Postgres (default: 120)
  -h, --help         Show this help
USG
  exit 0
}

# Parse CLI flags
timeout=120
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) timeout="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

# Compose prerequisites
ensure_compose_cmd

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Determine compose stack
ssl_provider="default"
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider)"
fi

# Build compose args
get_compose_base run "$ssl_provider"

# Validate environment variables
validate_env "$ENV_FILE" "$ssl_provider"

# Wait for database
step_sleep=5
max_attempts=$(( (timeout + step_sleep - 1) / step_sleep ))
(( max_attempts < 1 )) && max_attempts=1

printf "Waiting for database...\n"
user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
user="${user:-devpush-app}"
for ((attempt=1; attempt<=max_attempts; attempt++)); do
  if "${COMPOSE_BASE[@]}" exec -T pgsql pg_isready -U "$user" >/dev/null 2>&1; then
    break
  fi
  if ((attempt==max_attempts)); then
    err "Database not ready within ${timeout}s."
    exit 1
  fi
  sleep "$step_sleep"
done

# Run migrations
printf "Running database migrations...\n"
run_cmd "${CHILD_MARK} Alembic upgrade head" "${COMPOSE_BASE[@]}" exec -T app uv run alembic upgrade head

# Success message
printf "${GRN}Migrations applied. ✔${NC}\n"
