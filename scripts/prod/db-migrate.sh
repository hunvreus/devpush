#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

source "$(dirname "$0")/lib.sh"

# usage
usage(){
  cat <<USG
Usage: db-migrate.sh [--timeout <sec>] [--verbose]

Run Alembic database migrations in production (waits for DB/app readiness).

  --timeout SEC     Max wait for health (default: 120)
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

timeout=120
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) timeout="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }
ssl_provider="$(get_ssl_provider)"
compose_args stack "$ssl_provider"
args=("${COMPOSE_ARGS[@]}")
env_flag=("${COMPOSE_ENV[@]}")

# Validate environment variables
validate_core_env "$DATA_DIR/.env"

printf "\n"
run_cmd "Waiting for pgsql container..." bash -lc 'for i in $(seq 1 '"$((timeout/2))"'); do docker compose '"${env_flag[*]}"' '"${args[*]}"' ps -q pgsql | grep -q . && exit 0; sleep 1; done; exit 1'

run_cmd "Waiting for database..." docker compose "${env_flag[@]}" "${args[@]}" exec -T pgsql sh -lc 'for i in $(seq 1 '"$((timeout/5))"'); do pg_isready -U "${POSTGRES_USER:-devpush-app}" >/dev/null 2>&1 && exit 0; sleep 5; done; exit 1'

run_cmd "Waiting for app container..." bash -c 'for i in $(seq 1 '"$((timeout/5))"'); do docker ps --filter "name=devpush-app" -q | grep -q . && exit 0; sleep 5; done; exit 1'

printf "\n"
run_cmd "Running database migrations..." docker compose "${env_flag[@]}" "${args[@]}" exec -T app uv run alembic upgrade head

printf "\n"
echo -e "${GRN}Migrations applied. ✔${NC}"
