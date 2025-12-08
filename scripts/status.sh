#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "status"

usage(){
  cat <<USG
Usage: status.sh [-h|--help]

Show the status of /dev/push stack (dev or prod auto-detected).

  -h, --help         Show this help
USG
  exit 0
}

# Parse CLI flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

printf '\n'

# Check stack status
if is_stack_running; then
  printf "Status: ${GRN}up${NC}\n"
else
  printf "Status: ${DIM}down${NC}\n"
fi

printf "Environment: ${YEL}%s${NC}\n" "$ENVIRONMENT"
printf "App directory: %s\n" "$APP_DIR"
printf "Data directory: %s\n" "$DATA_DIR"

# Show containers if running
if is_stack_running; then
  printf '\n'
  set_compose_base
  "${COMPOSE_BASE[@]}" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
fi
