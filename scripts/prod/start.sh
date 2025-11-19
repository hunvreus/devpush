#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_ERR_LOG="/tmp/start_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Start failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage(){
  cat <<USG
Usage: start.sh [--env-file <path>] [--no-pull] [--migrate] [--ssl-provider <name>] [--verbose]

Start production services via Docker Compose. Optionally run DB migrations.

  --env-file PATH   Path to .env (default: ./\.env)
  --no-pull         Do not pass --pull always to docker compose up
  --migrate         Run DB migrations after starting
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure (default: from config or 'default')
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

app_dir="/home/devpush/devpush"; envf=".env"; pull_always=1; do_migrate=0; ssl_provider=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) envf="$2"; shift 2 ;;
    --no-pull) pull_always=0; shift ;;
    --migrate) do_migrate=1; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

# Load persisted config if any and resolve ssl_provider precedence
ssl_provider="${ssl_provider:-$(get_ssl_provider)}"
persist_ssl_provider "$ssl_provider"

# Check if setup is complete
setup_mode=0
if [[ -f /var/lib/devpush/config.json ]]; then
  # If config.json exists, check setup_complete flag
  if jq -e '.setup_complete == true' /var/lib/devpush/config.json >/dev/null 2>&1; then
    setup_mode=0
  else
    setup_mode=1
  fi
else
  setup_mode=1
fi

if (( setup_mode == 1 )); then
  # Start setup stack if setup is not complete
  printf "\n"
  echo "Starting setup stack..."
  run_cmd "${CHILD_MARK} Starting setup compose..." docker compose -p devpush -f docker-compose.setup.yml up -d --remove-orphans
else
  # Start full stack if setup is complete

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
fi

# Apply database migrations
if ((do_migrate==1)); then
  printf "\n"
  echo "Applying migrations..."
  run_cmd "${CHILD_MARK} Running database migrations..." scripts/prod/db-migrate.sh --env-file "$envf"
fi

printf "\n"
echo -e "${GRN}Services started. ✔${NC}"
