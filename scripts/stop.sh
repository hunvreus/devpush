#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

require_cmd kubectl

select_context
kubectl cluster-info --request-timeout=20s >/dev/null

for deployment in \
  "${RELEASE_NAME}-app" \
  "${RELEASE_NAME}-pgsql" \
  "${RELEASE_NAME}-redis" \
  "${RELEASE_NAME}-worker-jobs" \
  "${RELEASE_NAME}-worker-monitor" \
  "${RELEASE_NAME}-traefik" \
  "${RELEASE_NAME}-loki" \
  "${RELEASE_NAME}-alloy"; do
  if kubectl -n "$NAMESPACE" get deployment "$deployment" >/dev/null 2>&1; then
    kubectl -n "$NAMESPACE" scale deployment "$deployment" --replicas=0 >/dev/null
    printf "Scaled %s to 0.\n" "$deployment"
  fi
done

printf "Scaled deployments to 0 in namespace %s.\n" "$NAMESPACE"
