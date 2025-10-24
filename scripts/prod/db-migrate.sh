#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

source "$(dirname "$0")/lib.sh"

# usage
usage(){
  cat <<USG
Usage: db-migrate.sh [--app-dir <path>] [--env-file <path>] [--timeout <sec>] [--verbose]

Run Alembic database migrations in production (waits for DB/app readiness).

  --app-dir PATH    App directory (default: $PWD)
  --env-file PATH   Path to .env (default: ./\.env)
  --timeout SEC     Max wait for health (default: 120)
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

app_dir="${APP_DIR:-$(pwd)}"; envf=".env"; timeout=120
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) app_dir="$2"; shift 2 ;;
    --env-file) envf="$2"; shift 2 ;;
    --timeout) timeout="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

# Validate environment variables
validate_core_env "$envf"

printf "\n"
run_cmd "Waiting for database..." bash -c 'for i in $(seq 1 '"$((timeout/5))"'); do docker compose -p devpush exec -T pgsql pg_isready -U "${POSTGRES_USER:-devpush-app}" >/dev/null 2>&1 && exit 0; sleep 5; done; exit 1'

run_cmd "Waiting for app container..." bash -c 'for i in $(seq 1 '"$((timeout/5))"'); do [ "$(docker ps --filter "name=devpush-app" -q | wc -l | tr -d " ")" != "0" ] && exit 0; sleep 5; done; exit 1'

printf "\n"
run_cmd "Running database migrations..." docker compose -p devpush exec -T app uv run alembic upgrade head

printf "\n"
echo -e "${GRN}Migrations applied. ✔${NC}"