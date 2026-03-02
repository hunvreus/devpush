#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

WAIT_TIMEOUT_SECONDS="180"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      cat <<USG
Usage: reload.sh

Reload app and workers.
USG
      exit 0
      ;;
    *)
      printf "Unknown option: %s\n" "$1" >&2
      exit 1
      ;;
  esac
done

require_cmd kubectl
select_context
ensure_kube_api

kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-app" >/dev/null
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-worker-jobs" >/dev/null
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-worker-monitor" >/dev/null

kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-app" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-worker-jobs" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-worker-monitor" --timeout="${WAIT_TIMEOUT_SECONDS}s"

printf "Reloaded app/workers.\n"
print_access_urls
