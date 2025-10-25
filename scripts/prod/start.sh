#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Common library
source "$(dirname "$0")/lib.sh"

usage(){
  cat <<USG
Usage: start.sh [--app-dir <path>] [--env-file <path>] [--no-pull] [--migrate] [--ssl-provider <name>] [--verbose]

Start production services via Docker Compose. Optionally run DB migrations.

  --app-dir PATH    App directory (default: \$PWD)
  --env-file PATH   Path to .env (default: ./\.env)
  --no-pull         Do not pass --pull always to docker compose up
  --migrate         Run DB migrations after starting
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure (default: from config or 'default')
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

app_dir="${APP_DIR:-$(pwd)}"; envf=".env"; pull_always=1; do_migrate=0; ssl_provider=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) app_dir="$2"; shift 2 ;;
    --env-file) envf="$2"; shift 2 ;;
    --no-pull) pull_always=0; shift ;;
    --migrate) do_migrate=1; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

# Load persisted config if any and resolve ssl_provider precedence
ssl_provider="${ssl_provider:-$(get_ssl_provider)}"
persist_ssl_provider "$ssl_provider"

# Ensure acme.json exists with strict perms
ensure_acme_json

# Validate provider env vars (reads from env or the .env file)
validate_ssl_env "$ssl_provider" "$envf"

# Validate core environment variables
validate_core_env "$envf"

# Start services
printf "\n"
echo "Starting services..."
args=(-p devpush -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.override.ssl/"$ssl_provider".yml)
((pull_always==1)) && pullflag=(--pull always) || pullflag=()
run_cmd "${CHILD_MARK} Starting Docker Compose stack..." docker compose "${args[@]}" up -d "${pullflag[@]}" --remove-orphans

# Apply database migrations
if ((do_migrate==1)); then
  printf "\n"
  echo "Applying migrations..."
  run_cmd "${CHILD_MARK} Running database migrations..." scripts/prod/db-migrate.sh --app-dir "$app_dir" --env-file "$envf"
fi

printf "\n"
echo -e "${GRN}Services started. ✔${NC}"