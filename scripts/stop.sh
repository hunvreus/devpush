#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "stop"

usage(){
  cat <<USG
Usage: stop.sh [--hard] [-h|--help]

Stop the /dev/push stack (dev or prod auto-detected).

  --hard             Force stop all containers labeled for the devpush project
  -h, --help         Show this help
USG
  exit 0
}

# Force stop all containers labeled for the devpush project
force_stop_all() {
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker is required for --hard"
    exit 1
  fi
  local containers
  containers=$(docker ps --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null || true)
  containers_count=$(printf '%s\n' "$containers" | wc -l | tr -d ' ')
  printf '\n'
  if [[ -n "$containers" ]]; then
    run_cmd --try "Stopping containers ($containers_count found)..." docker stop $containers
  else
    printf "Stopping containers (0 found)... ${YEL}⊘${NC}\n"
  fi
}

# Stop the stack for the given mode (run or setup)
stop_stack_mode() {
  local mode="$1"
  local compose_file

  if [[ "$mode" == "run" ]]; then
    compose_file="$APP_DIR/compose/run.yml"
    label=""
  else
    compose_file="$APP_DIR/compose/setup.yml"
    label=" (setup mode)"
  fi

  if [[ "$mode" == "run" ]]; then
    set_compose_base run "$ssl_provider"
  else
    set_compose_base setup
  fi

  printf '\n'
  run_cmd "Stopping stack${label}..." "${COMPOSE_BASE[@]}" stop
}

# Parse CLI flags
hard_mode=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard) hard_mode=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

if ((hard_mode==0)); then
  if ! is_stack_running; then
    printf '\n'
    printf "${DIM}No running services to stop.${NC}\n"
    exit 0
  fi
fi

ssl_provider="$(get_ssl_provider)"

if ((hard_mode==1)); then
  force_stop_all
else
  running_stack="$(get_running_stack 2>/dev/null || echo "unknown")"
  if [[ "$running_stack" == "setup" ]]; then
    stop_stack_mode setup
  elif [[ "$running_stack" == "run" ]]; then
    stop_stack_mode run
  else
    stop_stack_mode setup "setup stack"
    stop_stack_mode run "run stack"
  fi
fi

# Success message
printf '\n'
printf "${GRN}Stack stopped. ✔${NC}\n"
