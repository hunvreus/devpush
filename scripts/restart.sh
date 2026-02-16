#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "restart"

usage(){
  cat <<USG
Usage: restart.sh [--components <csv>] [--no-migrate] [-h|--help]

Restart the /dev/push stack (stop + start).

  --components <csv>
                    Comma-separated list of services to restart (${VALID_COMPONENTS//|/, })
  --no-migrate        Skip running database migrations after start
  -h, --help          Show this help
USG
  exit 0
}

# Parse CLI flags
run_migrations=1
comps=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --components)
      comps="$2"
      IFS=',' read -ra _rs_secs <<< "$comps"
      for comp in "${_rs_secs[@]}"; do
        comp="${comp// /}"
        [[ -z "$comp" ]] && continue
        if ! validate_component "$comp"; then
          exit 1
        fi
      done
      shift 2
      ;;
    --no-migrate) run_migrations=0; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Check if stack is running
# Restart stack
printf '\n'
if [[ -n "$comps" ]]; then
  printf "Restarting selected services\n"
  run_cmd "${CHILD_MARK} Stopping selected services" bash "$SCRIPT_DIR/stop.sh" --components "$comps"
else
  printf "Restarting stack\n"
  run_cmd "${CHILD_MARK} Stopping stack" bash "$SCRIPT_DIR/stop.sh"
fi

start_args=()
((run_migrations==0)) && start_args+=(--no-migrate)
[[ -n "$comps" ]] && start_args+=(--components "$comps")
if ((${#start_args[@]})); then
  run_cmd "${CHILD_MARK} Starting stack" bash "$SCRIPT_DIR/start.sh" "${start_args[@]}"
else
  run_cmd "${CHILD_MARK} Starting stack" bash "$SCRIPT_DIR/start.sh"
fi

# Success message
printf '\n'
if [[ -n "$comps" ]]; then
  printf "${GRN}Selected services restarted. ✔${NC}\n"
else
  printf "${GRN}Stack restarted. ✔${NC}\n"
fi
