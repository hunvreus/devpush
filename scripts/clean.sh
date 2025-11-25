#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ERR_LOG="/tmp/clean_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "Clean failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage(){
  cat <<USG
Usage: clean.sh [--hard] [--yes] [-h|--help]

Stop the services and remove Docker data. Use --hard to remove ALL containers/images.

  --hard            Stop/remove ALL containers/images/images (dangerous)
  --yes             Skip confirmation prompts
  -h, --help        Show this help
USG
  exit 0
}

# Parse CLI flags
hard=0
yes_flag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard) hard=1; shift ;;
    --yes|-y) yes_flag=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

ensure_compose_cmd

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Confirmation prompt
if ((yes_flag==0)); then
  printf '\n'
  printf "${YEL}This will stop docker compose services, remove volumes and networks, and delete the data directory.${NC}\n"
  if [[ "$ENVIRONMENT" == "production" ]]; then
    printf "${RED}WARNING:${NC} You are running in production.\n"
  fi
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { printf "Aborted.\n"; exit 0; }
fi

# Stop stacks (main and setup)
printf '\n'
run_cmd "Stopping services..." bash "$SCRIPT_DIR/stop.sh"
printf '\n'
run_cmd "Stopping services (setup)..." bash "$SCRIPT_DIR/stop.sh" --setup || true

# Remove services with volumes
printf '\n'
ssl_provider="default"
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider)"
fi
get_compose_base run "$ssl_provider"
run_cmd "Removing volumes..." "${COMPOSE_BASE[@]}" down --remove-orphans --volumes || true

get_compose_base setup
run_cmd "Removing volumes (setup)..." "${COMPOSE_BASE[@]}" down --remove-orphans --volumes || true

# Remove known networks/volumes
printf '\n'
run_cmd "Removing networks..." bash -c 'docker network rm devpush_default devpush_internal >/dev/null 2>&1 || true'
run_cmd "Removing named volumes..." bash -c 'docker volume rm devpush_devpush-db devpush_loki-data devpush_alloy-data >/dev/null 2>&1 || true'

# Remove data dir
if [[ "$ENVIRONMENT" == "development" ]]; then
  printf '\n'
  run_cmd "Removing data directory..." rm -rf "$DATA_DIR"
else
  printf '\n'
  printf "${YEL}Skipping data directory removal in production (${DATA_DIR}).${NC}\n"
fi

# Hard prune if requested
if ((hard==1)); then
  printf '\n'
  run_cmd "Stopping all containers..." bash -c 'docker ps -aq | xargs -r docker stop'
  run_cmd "Removing all containers..." bash -c 'docker ps -aq | xargs -r docker rm'
  run_cmd "Removing all images..." bash -c 'docker images -aq | xargs -r docker rmi -f'
fi

printf '\n'
printf "${GRN}Clean complete.${NC}\n"
