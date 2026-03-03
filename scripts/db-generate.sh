#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "db-generate failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

usage() {
  cat <<USG
Usage: db-generate.sh [--message <value>] [--timeout <value>] [-h|--help]

Generate an Alembic migration in the app deployment.

  --message <value>   Migration message (if omitted, prompt in TTY)
  --timeout <value>   Rollout wait timeout in seconds (default: 240)
  -h, --help          Show this help
USG
  exit 0
}

message=""
timeout="$WAIT_TIMEOUT_SECONDS"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message)
      message="${2:-}"
      [[ -n "$message" ]] || { printf "Missing value for --message\n" >&2; exit 1; }
      shift 2
      ;;
    --timeout)
      timeout="${2:-}"
      [[ -n "$timeout" ]] || { printf "Missing value for --timeout\n" >&2; exit 1; }
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      printf "Unknown option: %s\n" "$1" >&2
      usage
      ;;
  esac
done

if [[ -z "$message" && -t 0 ]]; then
  printf "Migration message: "
  read -r message
fi
[[ -n "$message" ]] || { printf "Migration message is required.\n" >&2; exit 1; }

require_cmd colima
require_cmd kubectl

printf "# Kubernetes connection\n"
run_cmd "Ensuring Colima is running with Kubernetes..." ensure_colima_kubernetes
run_cmd "Using kubectl context: colima..." use_colima_context
run_cmd "Waiting for Kubernetes API..." wait_for_kube_api 45 2

printf '\n'
printf "# Wait for app\n"
run_cmd "Waiting for ${RELEASE_NAME}-app rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-app" --timeout="${timeout}s"

printf '\n'
printf "# Generate migration\n"
run_cmd "Running Alembic revision --autogenerate..." kubectl -n "$NAMESPACE" exec "deploy/${RELEASE_NAME}-app" -- sh -lc "cd /app && uv run alembic -c alembic.ini revision --autogenerate -m \"$message\""

printf '\n'
printf "Migration generated.\n"

