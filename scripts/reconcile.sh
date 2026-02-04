#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "reconcile"

usage(){
  cat <<USG
Usage: reconcile.sh [--deployment <id>] [-h|--help]

Run a one-off deployment reconciliation (observed state only).

  --deployment <id>  Reconcile a single deployment (optional)
  -h, --help         Show this help
USG
  exit 0
}

# Parse CLI flags
deployment_id=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployment) deployment_id="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Build compose args
set_compose_base

# Run reconcile
printf '\n'
if [[ -n "$deployment_id" ]]; then
  prev_verbose="${VERBOSE:-0}"
  VERBOSE=1 run_cmd "Reconciling deployment $deployment_id" "${COMPOSE_BASE[@]}" exec -T app \
    uv run python - <<PY
import asyncio
import aiodocker
from config import get_settings
from db import AsyncSessionLocal
from services.reconcile import reconcile_deployments


async def main() -> None:
    settings = get_settings()
    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            counts = await reconcile_deployments(
                db,
                docker_client,
                deployment_ids=["$deployment_id"],
            )
    print(f"processed={counts['processed']} observed={counts['observed']} missing={counts['missing']}")


asyncio.run(main())
PY
  VERBOSE="$prev_verbose"
else
  prev_verbose="${VERBOSE:-0}"
  VERBOSE=1 run_cmd "Reconciling all deployments" "${COMPOSE_BASE[@]}" exec -T app \
    uv run python - <<PY
import asyncio
import aiodocker
from config import get_settings
from db import AsyncSessionLocal
from services.reconcile import reconcile_deployments


async def main() -> None:
    settings = get_settings()
    async with AsyncSessionLocal() as db:
        async with aiodocker.Docker(url=settings.docker_host) as docker_client:
            counts = await reconcile_deployments(db, docker_client)
    print(f"processed={counts['processed']} observed={counts['observed']} missing={counts['missing']}")


asyncio.run(main())
PY
  VERBOSE="$prev_verbose"
fi

printf '\n'
printf "${GRN}Reconcile completed. ✔${NC}\n"
