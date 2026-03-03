#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Stop failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Validate local prerequisites
require_cmd colima
require_cmd kubectl

printf "# Connect to Kubernetes (Colima + k3s)\n"
if ! colima_running; then
  printf "Colima is not running. Nothing to stop.\n"
  exit 0
fi
run_cmd "Using kubectl context: colima..." use_colima_context
run_cmd "Waiting for Kubernetes API..." wait_for_kube_api 30 2

printf '\n'
printf "# Scale deployments down\n"
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
    run_cmd "Scaling ${deployment} to 0..." kubectl -n "$NAMESPACE" scale deployment "$deployment" --replicas=0 >/dev/null
  fi
done

printf '\n'
printf "Stack stopped in namespace %s.\n" "$NAMESPACE"

