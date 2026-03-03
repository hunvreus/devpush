#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "k8s-recover failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

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

# Ensure cluster baseline
printf "# Kubernetes runtime baseline\n"
run_cmd "Ensuring Colima is running with Kubernetes..." ensure_colima_kubernetes
run_cmd "Using kubectl context: colima..." use_colima_context

# Fast recover path (k3s restart only)
printf '\n'
printf "# Recover control plane\n"
run_cmd "Restarting k3s service in Colima..." colima ssh -- sudo systemctl restart k3s

if wait_for_kube_api 15 2; then
  run_cmd "Waiting for node readiness..." wait_for_node_ready 30 2
else
  # Deep recover path (docker + k3s restart)
  run_cmd "Restarting Docker service in Colima..." colima ssh -- sudo systemctl restart docker
  run_cmd "Restarting k3s service in Colima..." colima ssh -- sudo systemctl restart k3s
  run_cmd "Waiting for Kubernetes API..." wait_for_kube_api 45 2
  run_cmd "Waiting for node readiness..." wait_for_node_ready 45 2
fi

# Final status
printf '\n'
run_cmd "Current node status..." kubectl get nodes -o wide
printf '\n'
printf "${CLR_GREEN}Kubernetes recovery complete.${CLR_RESET}\n"
