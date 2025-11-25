#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_ERR_LOG="/tmp/compose_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "Compose command failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

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

# Compose prerequisites
ensure_compose_cmd
cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Build compose args
ssl_provider="default"
if [[ "$stack_mode" == "run" && "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider)"
fi
if [[ "$stack_mode" == "setup" ]]; then
  get_compose_base setup
else
  get_compose_base run "$ssl_provider"
fi

# Execute compose
printf '\n'
printf "Running docker compose (%s stack): %s\n" "$stack_mode" "$*"
exec "${COMPOSE_BASE[@]}" "$@"
