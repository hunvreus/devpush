#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "start"

usage(){
  cat <<USG
Usage: start.sh [--setup] [--no-migrate] [--ssl-provider <value>] [-v|--verbose] [-h|--help]

Start the /dev/push stack (dev or prod auto-detected).

  --setup             Force setup stack even if setup_complete=true
  --no-migrate        Skip running database migrations after start
  --ssl-provider <value>
                      One of: default|cloudflare|route53|gcloud|digitalocean|azure (default: from config or 'default')
  -v, --verbose       Enable verbose output
  -h, --help          Show this help
USG
  exit 0
}

force_setup=0
run_migrations=1
ssl_provider=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup) force_setup=1; shift ;;
    --no-migrate) run_migrations=0; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

ensure_compose_cmd

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Prepare data directories/config
mkdir -p "$DATA_DIR/traefik" "$DATA_DIR/upload"
if [[ ! -f "$CONFIG_FILE" ]]; then
  printf "{}" > "$CONFIG_FILE"
  chmod 0644 "$CONFIG_FILE" || true
  if [[ "$ENVIRONMENT" == "production" ]]; then
    service_user="$(default_service_user)"
    chown -R "$service_user:$service_user" "$DATA_DIR" || true
  fi
fi

# Handle SSL provider overrides
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="${ssl_provider:-$(get_ssl_provider)}"
  persist_ssl_provider "$ssl_provider"
else
  if [[ -n "$ssl_provider" ]]; then
    err "--ssl-provider is only supported in production."
  fi
fi
ssl_provider="${ssl_provider:-default}"

# Determine setup mode
setup_mode=0
if ((force_setup==1)); then
  setup_mode=1
elif ! is_setup_complete; then
  setup_mode=1
fi

# Skip migrations in setup mode
((setup_mode==1)) && run_migrations=0

# Validate env + ssl inputs
if ((setup_mode==0)); then
  validate_env "$ENV_FILE" "$ssl_provider"
  if [[ "$ENVIRONMENT" == "production" ]]; then
    ensure_acme_json
  fi
fi

# Check if stack is already running
if is_stack_running; then
  running_stack="$(detect_running_stack 2>/dev/null || echo "unknown")"
  if [[ "$running_stack" != "unknown" ]]; then
    if [[ "$ENVIRONMENT" == "production" ]]; then
      err "Stack is already running ($running_stack mode). Stop it first with: systemctl stop devpush.service"
    else
      err "Stack is already running ($running_stack mode). Stop it first with: scripts/stop.sh"
    fi
    exit 1
  fi
fi

# Build compose args
if ((setup_mode==1)); then
  get_compose_base setup
else
  get_compose_base run "$ssl_provider"
fi

# Add label for setup mode
mode_label=""
((setup_mode==1)) && mode_label=" (setup mode)"

# Start stack
printf '\n'
printf "Starting stack%s...\n" "$mode_label"
run_cmd "${CHILD_MARK} Starting services..." "${COMPOSE_BASE[@]}" up -d --remove-orphans

# Run migrations when appropriate
if ((run_migrations==1)); then
  run_cmd "${CHILD_MARK} Running database migrations..." bash "$SCRIPT_DIR/db-migrate.sh"
fi

# Success message
printf '\n'
printf "${GRN}Stack started%s. ✔${NC}\n" "$mode_label"
printf "${DIM}The app may take a while to be ready.${NC}\n"