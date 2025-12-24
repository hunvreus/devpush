#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "start"

usage(){
  cat <<USG
Usage: start.sh [--no-migrate] [--timeout <sec>] [-v|--verbose] [-h|--help]

Start the /dev/push stack (dev or prod auto-detected).

  --no-migrate      Skip running database migrations after start
  --timeout <sec>   Max seconds to wait for app to become healthy (default: 60)
  -v, --verbose     Enable verbose output
  -h, --help        Show this help
USG
  exit 0
}

run_migrations=1
timeout=60
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) timeout="$2"; shift 2 ;;
    --no-migrate) run_migrations=0; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

wait_for_docker() {
  local attempts=0
  while (( attempts < 10 )); do
    docker info >/dev/null 2>&1 && return 0
    sleep 1
    ((attempts+=1))
  done
  err "Docker not accessible. Is the daemon running?"
  return 1
}

wait_for_app_health() {
  local timeout_sec="$1"
  local deadline=$((SECONDS + timeout_sec))
  local status container

  while (( SECONDS < deadline )); do
    container="$(docker ps -a --filter "label=com.docker.compose.project=devpush" --filter "label=com.docker.compose.service=app" -q | head -1 || true)"
    if [[ -n "$container" ]]; then
      status="$(docker inspect --format '{{.State.Status}}{{if .State.Health}}:{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
      case "$status" in
        running:healthy|running) return 0 ;;
        exited:*|dead*|created*) break ;;
      esac
    fi
    sleep 2
  done

  err "Stack failed to become healthy. Check logs with: scripts/compose.sh logs -f app"
  return 1
}

# Validate Docker availability
printf '\n'
run_cmd "Waiting for Docker to be ready" wait_for_docker

# Default data directory
mkdir -p -m 0750 "$DATA_DIR/traefik" "$DATA_DIR/upload"
if [[ "$ENVIRONMENT" == "production" ]]; then
  service_user="$(default_service_user)"
  chown -R "$service_user:$service_user" "$DATA_DIR" || true
fi

# Validate env
validate_env "$ENV_FILE"
  ensure_acme_json

# Build compose args
set_compose_base

# Start stack
printf '\n'
if is_stack_running; then
  run_cmd "Ensuring services are running" "${COMPOSE_BASE[@]}" up -d --remove-orphans
else
  run_cmd "Starting services" "${COMPOSE_BASE[@]}" up -d --remove-orphans
fi

# Wait for app container to be healthy
printf '\n'
run_cmd "Waiting for app to be ready" wait_for_app_health "$timeout"

# Run migrations when appropriate
if ((run_migrations==1)); then
  run_cmd "${CHILD_MARK} Running database migrations" bash "$SCRIPT_DIR/db-migrate.sh"
fi

# Success message
printf '\n'
printf "${GRN}Stack started. ✔${NC}\n"
