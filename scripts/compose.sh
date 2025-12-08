#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "compose"

usage(){
  cat <<USG
Usage: compose.sh [--] <docker-compose args>

Wrapper around docker compose with the correct files/env for this environment.

  --                 Stop parsing options; pass the rest to docker compose
  -h, --help         Show this help

Examples:
  scripts/compose.sh ps
  scripts/compose.sh up -d
  scripts/compose.sh logs -f app
USG
  exit 0
}

# Parse CLI flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; break ;;
    -h|--help) usage ;;
    *) break ;;
  esac
done

if [[ $# -eq 0 ]]; then
  err "No docker compose command provided."
  usage
fi

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Build compose args
set_compose_base

# Execute compose
printf '\n'
printf "Running docker compose: %s\n" "$*"
exec "${COMPOSE_BASE[@]}" "$@"
