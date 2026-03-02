#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

require_cmd kubectl
select_context

kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-app" --timeout=180s >/dev/null
kubectl -n "$NAMESPACE" exec "deploy/${RELEASE_NAME}-app" -- sh -lc "cd /app && uv run alembic -c alembic.ini upgrade head"

printf "Database migrations applied.\n"
