#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "db-migrate"

usage() {
  cat <<USG
Usage: db-migrate.sh [--timeout <sec>] [-h|--help]

Run Alembic upgrades after ensuring Postgres and app are ready.

  --timeout <sec>    Max seconds to wait for services (default: 120)
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

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

start_cmd="scripts/start.sh"
if [[ "$ENVIRONMENT" == "production" ]]; then
  start_cmd="systemctl start devpush.service"
fi

ssl_provider="$(get_ssl_provider)"
set_compose_base run "$ssl_provider"

# Validate environment variables
validate_env "$ENV_FILE" "$ssl_provider"

postgres_user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
postgres_user="${postgres_user:-devpush-app}"

# Wait for the pgsql container to be ready
wait_for_db() {
  local user="$1"
  local max_attempts="$2"
  local sleep_seconds="${3:-5}"
  local timeout=$((max_attempts * sleep_seconds))
  local attempt=0

  while (( attempt < max_attempts )); do
    if "${COMPOSE_BASE[@]}" exec -T pgsql pg_isready -U "$user" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
    ((attempt+=1))
  done
  err "Database not ready within ${timeout}s."
  return 1
}

# Wait for app container
wait_for_app() {
  local max_attempts="$1"
  local sleep_seconds="${2:-5}"
  local timeout=$((max_attempts * sleep_seconds))
  local attempt=0

  while (( attempt < max_attempts )); do
    app_container_ids=$(docker ps --filter "name=devpush-app" -q 2>/dev/null || true)
    if [[ -n "$app_container_ids" ]]; then
      return 0
    fi
    sleep "$sleep_seconds"
    ((attempt+=1))
  done
  err "App container not ready within ${timeout}s."
  return 1
}

# Wait for database and app
step_sleep=5
max_attempts=$(( (timeout + step_sleep - 1) / step_sleep ))
(( max_attempts < 1 )) && max_attempts=1

printf '\n'
run_cmd "Waiting for database..." wait_for_db "$postgres_user" "$max_attempts" "$step_sleep"
printf '\n'
run_cmd "Waiting for app..." wait_for_app "$max_attempts" "$step_sleep"

# Run migrations
printf '\n'
run_cmd "Apply migrations..." "${COMPOSE_BASE[@]}" exec -T app uv run alembic upgrade head

# Success message
printf "${GRN}Migrations applied. ✔${NC}\n"
