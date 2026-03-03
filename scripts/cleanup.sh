#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Cleanup failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Parse CLI flags
usage() {
  cat <<USG
Usage: cleanup.sh [--yes] [--wipe-data] [-v|--verbose] [-h|--help]

Hard-reset local runtime state for /dev/push:
  - Stop/delete all Lima VMs (including Colima backend)
  - Delete all k3d clusters (if k3d is installed)
  - Remove runtime state: ~/.colima, ~/.lima, ~/.kube/cache
  - Remove kube contexts/clusters for colima and k3d-*
  - Prune Docker containers/images/volumes/networks/cache
  - Optionally wipe local data/logs with --wipe-data

  --yes,-y       Skip confirmation prompts
  --wipe-data    Also delete ${DATA_DIR} and ${LOGS_DIR}
  -v,--verbose   Enable verbose command output
  -h,--help      Show this help
USG
  exit 0
}

assume_yes=0
wipe_data=0
VERBOSE="${VERBOSE:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      assume_yes=1
      shift
      ;;
    --wipe-data)
      wipe_data=1
      shift
      ;;
    -v|--verbose)
      VERBOSE=1
      shift
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

confirm_or_exit() {
  local prompt="$1"
  if (( assume_yes == 1 )); then
    return 0
  fi
  printf "%s [y/N] " "$prompt"
  read -r answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf "Aborted.\n"; exit 0; }
}

is_cmd_available() {
  command -v "$1" >/dev/null 2>&1
}

stop_delete_lima_instances() {
  local instance
  while IFS= read -r instance; do
    [[ -n "$instance" ]] || continue
    limactl stop "$instance" >/dev/null 2>&1 || true
  done < <(limactl list 2>/dev/null | awk 'NR>1 {print $1}')

  while IFS= read -r instance; do
    [[ -n "$instance" ]] || continue
    run_cmd "Deleting Lima instance ${instance}..." limactl delete -f "$instance"
  done < <(limactl list 2>/dev/null | awk 'NR>1 {print $1}')
}

delete_k3d_clusters() {
  local cluster
  while IFS= read -r cluster; do
    [[ -n "$cluster" ]] || continue
    run_cmd "Deleting k3d cluster ${cluster}..." k3d cluster delete "$cluster"
  done < <(k3d cluster list --no-headers 2>/dev/null | awk '{print $1}')
}

stop_colima_quietly() {
  colima stop >/dev/null 2>&1 || true
}

delete_colima_quietly() {
  colima delete --force >/dev/null 2>&1 || true
}

clear_current_context_quietly() {
  kubectl config unset current-context >/dev/null 2>&1 || true
}

delete_kube_context_quietly() {
  local context_name="$1"
  kubectl config delete-context "$context_name" >/dev/null 2>&1 || true
}

delete_kube_cluster_quietly() {
  local cluster_name="$1"
  kubectl config delete-cluster "$cluster_name" >/dev/null 2>&1 || true
}

delete_kube_contexts_clusters() {
  local context_name cluster_name

  run_cmd "Clearing current kubectl context..." clear_current_context_quietly

  while IFS= read -r context_name; do
    [[ -n "$context_name" ]] || continue
    if [[ "$context_name" == "colima" || "$context_name" == k3d-* ]]; then
      run_cmd "Deleting kubectl context ${context_name}..." delete_kube_context_quietly "$context_name"
    fi
  done < <(kubectl config get-contexts -o name 2>/dev/null || true)

  while IFS= read -r cluster_name; do
    [[ -n "$cluster_name" ]] || continue
    if [[ "$cluster_name" == "colima" || "$cluster_name" == k3d-* ]]; then
      run_cmd "Deleting kubectl cluster ${cluster_name}..." delete_kube_cluster_quietly "$cluster_name"
    fi
  done < <(kubectl config view -o jsonpath='{.clusters[*].name}' 2>/dev/null | tr ' ' '\n' || true)
}

remove_all_docker_containers() {
  docker ps -aq | xargs -r docker rm -f
}

confirm_or_exit "This will hard-reset local Kubernetes/Docker runtime state. Continue?"

# Stop/delete local Kubernetes runtimes.
printf "Reset local runtimes\n"
if is_cmd_available limactl; then
  run_cmd "Stopping/deleting all Lima instances..." stop_delete_lima_instances
else
  printf "${CLR_DIM}%s limactl not found (skipped).${CLR_RESET}\n" "$CHILD_MARK"
fi

if is_cmd_available colima; then
  run_cmd "Stopping Colima..." stop_colima_quietly
  run_cmd "Deleting Colima VM..." delete_colima_quietly
else
  printf "${CLR_DIM}%s colima not found (skipped).${CLR_RESET}\n" "$CHILD_MARK"
fi

if is_cmd_available k3d; then
  run_cmd "Deleting all k3d clusters..." delete_k3d_clusters
else
  printf "${CLR_DIM}%s k3d not found (skipped).${CLR_RESET}\n" "$CHILD_MARK"
fi

printf '\n'
# Remove runtime state directories.
printf "Remove runtime state directories\n"
run_cmd "Removing ~/.colima..." rm -rf "$HOME/.colima"
run_cmd "Removing ~/.lima..." rm -rf "$HOME/.lima"
run_cmd "Removing ~/.kube/cache..." rm -rf "$HOME/.kube/cache"

printf '\n'
# Clean kubeconfig contexts/clusters.
printf "Clean kube contexts/clusters\n"
if is_cmd_available kubectl; then
  run_cmd "Removing kubectl colima/k3d contexts and clusters..." delete_kube_contexts_clusters
else
  printf "${CLR_DIM}%s kubectl not found (skipped).${CLR_RESET}\n" "$CHILD_MARK"
fi

printf '\n'
# Prune Docker resources.
printf "Prune Docker resources\n"
if is_cmd_available docker; then
  if docker info >/dev/null 2>&1; then
    run_cmd "Removing all Docker containers..." remove_all_docker_containers
    run_cmd "Pruning Docker system (images/volumes/networks/cache)..." docker system prune -af --volumes
  else
    printf "${CLR_DIM}%s Docker daemon not running (skipped).${CLR_RESET}\n" "$CHILD_MARK"
  fi
else
  printf "${CLR_DIM}%s docker not found (skipped).${CLR_RESET}\n" "$CHILD_MARK"
fi

printf '\n'
# Optional local data wipe.
if (( wipe_data == 1 )); then
  confirm_or_exit "This will permanently delete ${DATA_DIR} and ${LOGS_DIR}. Continue?"
  run_cmd "Removing local data/logs folders..." rm -rf "$DATA_DIR" "$LOGS_DIR"
else
  printf "${CLR_DIM}%s Keeping local data/logs folders.${CLR_RESET}\n" "$CHILD_MARK"
fi

printf '\n'
printf "${CLR_GREEN}Cleanup complete.${CLR_RESET}\n"
