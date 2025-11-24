#!/bin/bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/dev/compose.sh [--setup] [--] <docker-compose args>

Runs docker-compose with the correct dev compose files:
  --setup    Use the setup stack (compose/setup.yml + setup.override.dev.yml)
If --setup is omitted we use the main stack (compose/base.yml + override.dev.yml).

Examples:
  scripts/dev/compose.sh up -d
  scripts/dev/compose.sh logs -f app
  scripts/dev/compose.sh --setup up
USAGE
  exit 0
}

setup_mode=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup)
      setup_mode=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

args=()
if (( setup_mode == 1 )); then
  args=(-p devpush -f compose/setup.yml -f compose/setup.override.dev.yml)
else
  args=(-p devpush -f compose/base.yml -f compose/override.dev.yml)
  env_file="./data/.env"
  if [[ -f "$env_file" ]]; then
    args=(--env-file "$env_file" "${args[@]}")
  fi
fi

if [[ $# -eq 0 ]]; then
  set -- up
fi

docker-compose "${args[@]}" "$@"

