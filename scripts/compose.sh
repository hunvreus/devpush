#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "compose"

usage(){
  cat <<USG
Usage: compose.sh [--setup] [--] <docker-compose args>

Wrapper around docker compose with the correct files/env for this environment.

  --setup            Run against the setup stack (compose/setup.yml + overrides)
  --                 Stop parsing options; pass the rest to docker compose
  -h, --help         Show this help

Examples:
  scripts/compose.sh ps
  scripts/compose.sh up -d
  scripts/compose.sh --setup logs -f app
USG
  exit 0
}

# Parse CLI flags
stack_mode="run"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup) stack_mode="setup"; shift ;;
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
if [[ "$stack_mode" == "setup" ]]; then
  set_compose_base setup
else
  ssl_provider="$(get_ssl_provider)"
  set_compose_base run "$ssl_provider"
fi

# Execute compose
printf '\n'
printf "Running docker compose (%s stack): %s\n" "$stack_mode" "$*"
exec "${COMPOSE_BASE[@]}" "$@"
