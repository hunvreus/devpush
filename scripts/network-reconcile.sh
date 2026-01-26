#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "network-reconcile"

usage(){
  cat <<USG
Usage: network-reconcile.sh [--deployment-id <id>] [-h|--help]

Enqueue a network reconciliation task for edge networks.

  --deployment-id <id>   Target a specific deployment (default: all)
  -h, --help             Show this help
USG
  exit 0
}

# Parse CLI flags
deployment_id=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployment-id)
      [[ $# -gt 1 ]] || { err "Missing value for --deployment-id"; usage; }
      deployment_id="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Enqueue reconcile job
printf '\n'
set_compose_base
deploy_arg=""
if [[ -n "$deployment_id" ]]; then
  deploy_arg=", \"$deployment_id\""
fi
PY_CMD="import asyncio
from arq.connections import RedisSettings, create_pool
from config import get_settings

async def main():
    settings = get_settings()
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    redis = await create_pool(redis_settings)
    await redis.enqueue_job(\"reconcile_edge_network\"${deploy_arg})
    await redis.aclose()

asyncio.run(main())"

run_cmd "Enqueueing edge network reconcile..." \
  "${COMPOSE_BASE[@]}" exec -T app uv run python -c "$PY_CMD"

# Success
printf '\n'
printf "${GRN}Network reconcile queued. ✔${NC}\n"
