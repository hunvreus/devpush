#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "k8s-reset failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

usage() {
  cat <<USG
Usage: k8s-reset.sh [--hard] [--namespace <value>] [--timeout <value>] [-h|--help]

Reset local Kubernetes runtime health without wiping project data by default.

  --hard               Recreate Colima VM (keeps project ./data, wipes cluster runtime state)
  --namespace <value>  Namespace for stale runner cleanup (default: ${NAMESPACE})
  --timeout <value>    API/node wait timeout seconds (default: 120)
  -h, --help           Show this help
USG
  exit 0
}

hard_reset=0
timeout_seconds=120
target_namespace="$NAMESPACE"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard)
      hard_reset=1
      shift
      ;;
    --namespace)
      target_namespace="${2:-}"
      [[ -n "$target_namespace" ]] || { printf "Missing value for --namespace\n" >&2; exit 1; }
      shift 2
      ;;
    --timeout)
      timeout_seconds="${2:-}"
      [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || { printf "Invalid --timeout value\n" >&2; exit 1; }
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

wait_for_node_ready() {
  local timeout="$1"
  local retries=$(( timeout / 2 ))
  (( retries < 1 )) && retries=1
  local attempt=1
  local node_name

  while (( attempt <= retries )); do
    node_name="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "$node_name" ]] && kubectl wait --for=condition=Ready "node/${node_name}" --timeout=8s >/dev/null 2>&1; then
      return 0
    fi
    printf "Node not ready (attempt %d/%d); retrying in 2s...\n" "$attempt" "$retries"
    sleep 2
    ((attempt++))
  done
  return 1
}

cleanup_stale_runners() {
  local namespace="$1"
  kubectl -n "$namespace" delete deploy,svc,ing -l app.kubernetes.io/name=devpush-runner --ignore-not-found >/dev/null
}

# Validate prerequisites
require_cmd colima
require_cmd kubectl

printf "# Reset Kubernetes runtime\n"

if (( hard_reset == 1 )); then
  printf "${CLR_YELLOW}Hard reset enabled: recreating Colima VM.${CLR_RESET}\n"
  run_cmd "Stopping Colima..." colima stop >/dev/null 2>&1 || true
  run_cmd "Deleting Colima VM..." colima delete --force >/dev/null 2>&1 || true
  run_cmd "Starting Colima with Kubernetes..." ensure_colima_kubernetes
else
  run_cmd "Ensuring Colima is running with Kubernetes..." ensure_colima_kubernetes
  run_cmd "Restarting Docker service in Colima..." colima ssh -- sudo systemctl restart docker
  run_cmd "Restarting k3s service in Colima..." colima ssh -- sudo systemctl restart k3s
fi

run_cmd "Using kubectl context: colima..." use_colima_context
run_cmd "Waiting for Kubernetes API..." wait_for_kube_api "$(( timeout_seconds / 2 ))" 2
run_cmd "Cleaning stale runner workloads..." cleanup_stale_runners "$target_namespace"
run_cmd "Waiting for node readiness..." wait_for_node_ready "$timeout_seconds"

printf '\n'
run_cmd "Current node status..." kubectl get nodes -o wide
printf '\n'
printf "${CLR_GREEN}Kubernetes reset complete.${CLR_RESET}\n"
