#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "db-generate"

usage(){
  cat <<USG
Usage: db-generate.sh [-h|--help]

Generate an Alembic migration from model changes (executes inside the app container).

  -h, --help        Show this help
USG
  exit 0
}
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

start_cmd="scripts/start.sh"
if [[ "$ENVIRONMENT" == "production" ]]; then
  start_cmd="systemctl start devpush.service"
fi

set_compose_base

# Check if database is ready
postgres_user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
postgres_user="${postgres_user:-devpush-app}"
if ! "${COMPOSE_BASE[@]}" exec -T pgsql pg_isready -U "$postgres_user" >/dev/null 2>&1; then
  err "Database is not ready. Wait for it to be ready or start the stack with $start_cmd first."
  exit 1
fi

# Check if app is ready
app_container_ids=$(docker ps --filter "name=devpush-app" -q 2>/dev/null || true)
if [[ -z "$app_container_ids" ]]; then
  err "App is not ready. Wait for it to be ready or start the stack with $start_cmd first."
  exit 1
fi

# Read migration message
printf '\n'
read -r -p "Migration message: " message
[[ -n "$message" ]] || { err "Migration message is required."; exit 1; }

# Generate migration
printf '\n'
printf "Generating migration...\n"
run_cmd "Generating migration..." "${COMPOSE_BASE[@]}" exec -T app uv run alembic revision --autogenerate -m "$message"

# Success message
printf '\n'
printf "${GRN}Migration created successfully. ✔${NC}\n"
