#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ERR_LOG="/tmp/db-generate_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "db-generate failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage(){
  cat <<USG
Usage: db-generate.sh [-h|--help]

Generate an Alembic migration from model changes (executes inside the app container).

  -h, --help        Show this help
USG
  exit 0
}
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

ensure_compose_cmd

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Determine compose stack
ssl_provider="default"
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider)"
fi

get_compose_base run "$ssl_provider"

# Check if app container is running
app_container_ids=$(docker ps --filter "name=devpush-app" -q 2>/dev/null || true)
if [[ -z "$app_container_ids" ]]; then
  err "App container is not running. Start the stack with scripts/start.sh first."
  exit 1
fi

# Read migration message
printf '\n'
read -r -p "Migration message: " message
[[ -n "$message" ]] || { err "Migration message is required."; }

# Generate migration
printf '\n'
printf "Generating migration...\n"

user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
user="${user:-devpush-app}"
attempts=0
until "${COMPOSE_BASE[@]}" exec -T pgsql pg_isready -U "$user" >/dev/null 2>&1; do
  sleep 2
  ((attempts++))
  if ((attempts>=30)); then
    err "Database not ready."
  fi
done
run_cmd "${CHILD_MARK} Waiting for database..." true

run_cmd "${CHILD_MARK} Creating Alembic revision..." "${COMPOSE_BASE[@]}" exec -T app uv run alembic revision --autogenerate -m "$message"

# Success message
printf '\n'
printf "${GRN}Migration created successfully. ✔${NC}\n"
