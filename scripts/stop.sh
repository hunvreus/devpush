#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ERR_LOG="/tmp/stop_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "Stop failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage(){
  cat <<USG
Usage: stop.sh [--hard] [-h|--help]

Stop the /dev/push stack (dev or prod auto-detected).

  --hard             Use 'docker compose down --remove-orphans' instead of 'stop'
  -h, --help         Show this help
USG
  exit 0
}

# Parse CLI flags
hard_stop=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard) hard_stop=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

ensure_compose_cmd
cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Check what's actually running
if ! is_stack_running; then
  printf '\n'
  printf "${DIM}No running services to stop.${NC}\n"
  exit 0
fi

# Detect what's running
running_stack="$(detect_running_stack 2>/dev/null || echo "unknown")"
mode_label=""
if [[ "$running_stack" == "setup" ]]; then
  mode_label=" (setup mode)"
elif [[ "$running_stack" == "run" ]]; then
  mode_label=""
else
  mode_label=" (unknown)"
fi

ssl_provider="default"
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider 2>/dev/null || echo "default")"
fi

# Stop stack
printf '\n'
printf "Stopping stack%s...\n" "$mode_label"

if [[ "$running_stack" == "setup" ]]; then
  get_compose_base setup
  if ((hard_stop==1)); then
    run_cmd "${CHILD_MARK} Stopping services (down)..." "${COMPOSE_BASE[@]}" down --remove-orphans
  else
    run_cmd "${CHILD_MARK} Stopping services..." "${COMPOSE_BASE[@]}" stop
  fi
elif [[ "$running_stack" == "run" ]]; then
  get_compose_base run "$ssl_provider"
  if ((hard_stop==1)); then
    run_cmd "${CHILD_MARK} Stopping services (down)..." "${COMPOSE_BASE[@]}" down --remove-orphans
  else
    run_cmd "${CHILD_MARK} Stopping services..." "${COMPOSE_BASE[@]}" stop
  fi
else
  containers=$(docker ps --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null)
  if [[ -n "$containers" ]]; then
    if ((hard_stop==1)); then
      run_cmd "${CHILD_MARK} Stopping all containers (down)..." bash -c "docker stop $containers 2>/dev/null || true; docker compose -p devpush down --remove-orphans 2>/dev/null || true"
    else
      run_cmd "${CHILD_MARK} Stopping all containers..." docker stop $containers 2>/dev/null || true
    fi
  fi
fi

# Success message
printf '\n'
printf "${GRN}Stack stopped. ✔${NC}\n"
