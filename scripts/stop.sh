#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "stop"

usage(){
  cat <<USG
Usage: stop.sh [--hard] [--systemd] [-h|--help]

Stop the /dev/push stack (dev or prod auto-detected).

  --hard             Force stop all containers labeled for the devpush project
  --systemd          Stop devpush.service before stopping containers
  -h, --help         Show this help
USG
  exit 0
}

force_stop_all() {
  printf '\n'
  printf "Force stopping all devpush containers...\n"
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker is required for --hard"
    exit 1
  fi
  local containers
  containers=$(docker ps -a --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null || true)
  if [[ -n "$containers" ]]; then
    run_cmd "${CHILD_MARK} Removing containers..." bash -c "docker rm -f $containers >/dev/null 2>&1 || true"
  else
    printf "${DIM}%s No devpush containers found${NC}\n" "$CHILD_MARK"
  fi
  printf '\n'
  printf "${GRN}Force stop complete. ✔${NC}\n"
}

stop_stack_mode() {
  local mode="$1"
  local label="$2"
  local compose_file

  if [[ "$mode" == "run" ]]; then
    compose_file="$APP_DIR/compose/run.yml"
  else
    compose_file="$APP_DIR/compose/setup.yml"
  fi

  if [[ ! -f "$compose_file" ]]; then
    printf "${DIM}%s Skipping %s (missing %s)${NC}\n" "$CHILD_MARK" "$label" "${compose_file#$APP_DIR/}"
    return 0
  fi

  if [[ "$mode" == "run" ]]; then
    get_compose_base run "$ssl_provider"
  else
    get_compose_base setup
  fi

  run_cmd "${CHILD_MARK} Stopping ${label}..." "${COMPOSE_BASE[@]}" stop
}

# Parse CLI flags
hard_mode=0
stop_unit_flag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard) hard_mode=1; stop_unit_flag=1; shift ;;
    --systemd) stop_unit_flag=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

if ((stop_unit_flag==1)); then
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^devpush.service'; then
    run_cmd_try "${CHILD_MARK} Stopping systemd unit..." systemctl stop devpush.service
  fi
fi

if ((hard_mode==1)); then
  if [[ -d "$APP_DIR" ]]; then
    ensure_compose_cmd
    cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }
    ssl_provider="default"
    if [[ "$ENVIRONMENT" == "production" ]]; then
      ssl_provider="$(get_ssl_provider 2>/dev/null || echo "default")"
    fi
    stop_stack_mode run "run stack"
    stop_stack_mode setup "setup stack"
  fi
  force_stop_all
  exit 0
fi

ensure_compose_cmd
cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

if ! is_stack_running; then
  printf '\n'
  printf "${DIM}No running services to stop.${NC}\n"
  exit 0
fi

ssl_provider="default"
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider 2>/dev/null || echo "default")"
fi

running_stack="$(detect_running_stack 2>/dev/null || echo "unknown")"
mode_label=""
if [[ "$running_stack" == "setup" ]]; then
  mode_label=" (setup mode)"
elif [[ "$running_stack" == "run" ]]; then
  mode_label=""
else
  mode_label=" (unknown)"
fi

printf '\n'
printf "Stopping stack%s...\n" "$mode_label"

if [[ "$running_stack" == "setup" ]]; then
  stop_stack_mode setup "setup stack"
elif [[ "$running_stack" == "run" ]]; then
  stop_stack_mode run "run stack"
else
  force_stop_all
fi

# Success message
printf '\n'
printf "${GRN}Stack stopped. ✔${NC}\n"
