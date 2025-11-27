#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { printf "This script must be run as root (sudo).\n" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "status"

usage(){
  cat <<USG
Usage: status.sh [-h|--help]

Show the status of /dev/push stacks (dev or prod auto-detected).

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

ensure_compose_cmd
cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

printf '\n'
# Check stack status
if is_stack_running; then
  running_stack="$(detect_running_stack 2>/dev/null || echo "unknown")"
  if [[ "$running_stack" == "setup" ]]; then
    printf "Status: ${GRN}up (setup)${NC}\n"
  elif [[ "$running_stack" == "run" ]]; then
    printf "Status: ${GRN}up${NC}\n"
  else
    printf "Status: ${GRN}up (unknown)${NC}\n"
  fi
else
  printf "Status: ${DIM}down${NC}\n"
fi

printf "Environment: ${YEL}%s${NC}\n" "$ENVIRONMENT"

# Check setup status
if [[ -f "$CONFIG_FILE" ]]; then
  if [[ "$(json_get setup_complete "$CONFIG_FILE" false)" == "true" ]]; then
    printf "Setup complete: ${GRN}true${NC}\n"
  else
    printf "Setup complete: ${RED}false${NC}\n"
  fi
else
  printf "Setup complete: ${DIM}No config file${NC}\n"
fi

printf "App directory: %s\n" "$APP_DIR"
printf "Data directory: %s\n" "$DATA_DIR"

# Show containers if running
if is_stack_running; then
  printf '\n'
  running_stack="$(detect_running_stack 2>/dev/null || echo "unknown")"
  
  if [[ "$running_stack" == "setup" ]]; then
    get_compose_base setup
    "${COMPOSE_BASE[@]}" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
  elif [[ "$running_stack" == "run" ]]; then
    ssl_provider="default"
    if [[ "$ENVIRONMENT" == "production" ]]; then
      ssl_provider="$(get_ssl_provider 2>/dev/null || echo "default")"
    fi
    get_compose_base run "$ssl_provider"
    "${COMPOSE_BASE[@]}" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
  else
    docker ps --filter "label=com.docker.compose.project=devpush" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
  fi
fi