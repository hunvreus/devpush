#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
SCRIPT_ERR_LOG="/tmp/stop_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Stop failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage(){
  cat <<USG
Usage: stop.sh [--down]

Stop production services. Use --down for a hard stop with removal of orphans.

  --down            Use 'docker compose down --remove-orphans' (hard stop)
  -h, --help        Show this help
USG
  exit 0
}

hard=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --down) hard=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

printf "\n"
ssl_provider="$(get_ssl_provider)"
compose_args stack "$ssl_provider"
if ((hard==1)); then
  run_cmd "Stopping services (hard)..." DATA_DIR="$DATA_DIR" docker compose "${COMPOSE_ENV[@]}" "${COMPOSE_ARGS[@]}" down --remove-orphans
else
  run_cmd "Stopping services..." DATA_DIR="$DATA_DIR" docker compose "${COMPOSE_ENV[@]}" "${COMPOSE_ARGS[@]}" stop
fi

printf "\n"
echo -e "${GRN}Services stopped. ✔${NC}"
