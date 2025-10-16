#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
exec 2> >(tee /tmp/stop_error.log >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Stop failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/stop_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage(){
  cat <<USG
Usage: stop.sh [--app-dir <path>] [--down]

Stop production services. Use --down for a hard stop with removal of orphans.

  --app-dir PATH    App directory (default: \$PWD)
  --down            Use 'docker compose down --remove-orphans' (hard stop)
  -h, --help        Show this help
USG
  exit 0
}

app_dir="${APP_DIR:-$(pwd)}"; hard=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) app_dir="$2"; shift 2 ;;
    --down) hard=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

info "Stopping services..."
args=(-p devpush)
if ((hard==1)); then
  docker compose "${args[@]}" down --remove-orphans
else
  docker compose "${args[@]}" stop
fi
ok "Stopped."