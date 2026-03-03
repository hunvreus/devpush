#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "k8s-up failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

wait_for_node_ready() {
  local retries="${1:-45}"
  local delay_seconds="${2:-2}"
  local attempt=1
  local node_name

  while (( attempt <= retries )); do
    node_name="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "$node_name" ]] && kubectl wait --for=condition=Ready "node/${node_name}" --timeout=8s >/dev/null 2>&1; then
      return 0
    fi
    printf "Node not ready (attempt %d/%d); retrying in %ss...\n" "$attempt" "$retries" "$delay_seconds"
    sleep "$delay_seconds"
    ((attempt++))
  done

  printf "Node did not become Ready after %d attempts.\n" "$retries" >&2
  return 1
}

# Validate prerequisites
require_cmd colima
require_cmd kubectl

# Start local Kubernetes
printf "# Start Kubernetes (Colima + k3s)\n"
run_cmd "Ensuring Colima is running with Kubernetes..." ensure_colima_kubernetes
run_cmd "Using kubectl context: colima..." use_colima_context
run_cmd "Waiting for Kubernetes API..." wait_for_kube_api 30 2
run_cmd "Waiting for node readiness..." wait_for_node_ready 30 2

# Final status
printf '\n'
run_cmd "Current node status..." kubectl get nodes -o wide
printf '\n'
printf "${CLR_GREEN}Kubernetes is ready.${CLR_RESET}\n"
