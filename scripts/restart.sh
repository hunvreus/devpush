#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "restart"

usage(){
  cat <<USG
Usage: restart.sh [--no-migrate] [-h|--help]

Restart the /dev/push stack (stop + start).

  --no-migrate        Skip running database migrations after start
  -h, --help          Show this help
USG
  exit 0
}

# Parse CLI flags
run_migrations=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-migrate) run_migrations=0; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Check if stack is running
if ! is_stack_running; then
  err "No running services to restart."
  exit 1
fi

# Restart stack
printf '\n'
printf "Restarting stack...\n"
run_cmd "${CHILD_MARK} Stopping stack..." bash "$SCRIPT_DIR/stop.sh"

start_args=()
((run_migrations==0)) && start_args+=(--no-migrate)
if ((${#start_args[@]})); then
  run_cmd "${CHILD_MARK} Starting stack..." bash "$SCRIPT_DIR/start.sh" "${start_args[@]}"
else
  run_cmd "${CHILD_MARK} Starting stack..." bash "$SCRIPT_DIR/start.sh"
fi

# Success message
printf '\n'
printf "${GRN}Stack restarted. ✔${NC}\n"
printf "${DIM}The app may take a while to be ready.${NC}\n"
