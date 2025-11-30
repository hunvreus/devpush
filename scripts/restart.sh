#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "restart"

usage(){
  cat <<USG
Usage: restart.sh [--setup] [--no-migrate] [-h|--help]

Restart the /dev/push stack (stop + start).

  --setup             Restart the setup stack instead of the main stack
  --no-migrate        Skip running database migrations after start
  -h, --help          Show this help
USG
  exit 0
}

# Parse CLI flags
force_setup=0
run_migrations=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup) force_setup=1; shift ;;
    --no-migrate) run_migrations=0; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

# Check if stack is running
if ! is_stack_running; then
  err "No running services to restart."
  exit 1
fi

# Detect what's currently running (for stop label)
current_mode="$(get_running_stack 2>/dev/null || echo "unknown")"
stop_mode_label=""
if [[ "$current_mode" == "setup" ]]; then
  stop_mode_label=" (setup mode)"
fi

# Determine what we're starting (for start label)
setup_mode=0
if ((force_setup==1)); then
  setup_mode=1
elif ! is_setup_complete; then
  setup_mode=1
fi

start_mode_label=""
((setup_mode==1)) && start_mode_label=" (setup mode)"

# Restart stack
printf '\n'
printf "Restarting stack...\n"
run_cmd "${CHILD_MARK} Stopping stack${stop_mode_label}..." bash "$SCRIPT_DIR/stop.sh"

start_args=()
((force_setup==1)) && start_args+=(--setup)
((run_migrations==0)) && start_args+=(--no-migrate)
if ((${#start_args[@]})); then
  run_cmd "${CHILD_MARK} Starting stack${start_mode_label}..." bash "$SCRIPT_DIR/start.sh" "${start_args[@]}"
else
  run_cmd "${CHILD_MARK} Starting stack${start_mode_label}..." bash "$SCRIPT_DIR/start.sh"
fi

# Success message
printf '\n'
printf "${GRN}Stack restarted. ✔${NC}\n"
printf "${DIM}The app may take a while to be ready.${NC}\n"