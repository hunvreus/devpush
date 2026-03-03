#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Cleanup failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

usage() {
  cat <<USG
Usage: cleanup.sh [--yes] [--wipe-data]

Hard-reset local runtime state for /dev/push:
  - Stop/delete all Lima VMs (including Colima backend)
  - Remove ~/.colima and ~/.lima
  - Delete all k3d clusters (if k3d is installed)
  - Remove kube contexts/clusters (colima + k3d-*)
  - Prune all Docker containers/images/volumes/networks/cache
  - local ./data and ./logs only with --wipe-data
USG
}

assume_yes=0
wipe_data=0

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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf "Unknown option: %s\n" "$1" >&2
      usage
      exit 1
      ;;
  esac
done

if (( assume_yes == 0 )); then
  printf "This will hard-reset local Kubernetes/Docker runtime state. Continue? [y/N] "
  read -r answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf "Aborted.\n"; exit 0; }
fi

# Stop and delete all Lima VMs first.
if require_cmd limactl; then
  printf "Stopping all Lima instances...\n"
  while IFS= read -r instance; do
    [[ -n "$instance" ]] || continue
    run_cmd "Stopping Lima instance ${instance}..." limactl stop "$instance" >/dev/null 2>&1 || true
  done < <(limactl list 2>/dev/null | awk 'NR>1 {print $1}')

  printf "Deleting all Lima instances...\n"
  while IFS= read -r instance; do
    [[ -n "$instance" ]] || continue
    run_cmd "Deleting Lima instance ${instance}..." limactl delete -f "$instance"
  done < <(limactl list 2>/dev/null | awk 'NR>1 {print $1}')
fi

# Colima explicit cleanup.
if require_cmd colima; then
  run_cmd "Stopping Colima..." colima stop >/dev/null 2>&1 || true
  run_cmd "Deleting Colima VM..." colima delete --force >/dev/null 2>&1 || true
fi

# Delete all k3d clusters.
if require_cmd k3d; then
  printf "Deleting all k3d clusters...\n"
  while IFS= read -r cluster; do
    [[ -n "$cluster" ]] || continue
    run_cmd "Deleting k3d cluster ${cluster}..." k3d cluster delete "$cluster"
  done < <(k3d cluster list --no-headers 2>/dev/null | awk '{print $1}')
fi

# Remove runtime state directories.
run_cmd "Removing ~/.colima ..." rm -rf "$HOME/.colima"
run_cmd "Removing ~/.lima ..." rm -rf "$HOME/.lima"
run_cmd "Removing kubectl cache ..." rm -rf "$HOME/.kube/cache"

# Kubernetes config cleanup.
if require_cmd kubectl; then
  run_cmd "Clearing current kubectl context..." kubectl config unset current-context >/dev/null 2>&1 || true
  printf "Removing kubectl contexts/clusters...\n"
  while IFS= read -r context_name; do
    [[ -n "$context_name" ]] || continue
    if [[ "$context_name" == "colima" || "$context_name" == k3d-* ]]; then
      run_cmd "Deleting kubectl context ${context_name}..." kubectl config delete-context "$context_name" >/dev/null 2>&1 || true
    fi
  done < <(kubectl config get-contexts -o name 2>/dev/null || true)
  while IFS= read -r cluster_name; do
    [[ -n "$cluster_name" ]] || continue
    if [[ "$cluster_name" == "colima" || "$cluster_name" == k3d-* ]]; then
      run_cmd "Deleting kubectl cluster ${cluster_name}..." kubectl config delete-cluster "$cluster_name" >/dev/null 2>&1 || true
    fi
  done < <(kubectl config view -o jsonpath='{.clusters[*].name}' 2>/dev/null | tr ' ' '\n' || true)
fi

# Docker cleanup
if require_cmd docker; then
  if docker info >/dev/null 2>&1; then
    run_cmd "Removing all Docker containers..." sh -lc 'docker ps -aq | xargs -r docker rm -f'
    run_cmd "Pruning Docker system (images/volumes/networks/cache)..." docker system prune -af --volumes
  else
    printf "Docker daemon not running; skipping docker prune.\n"
  fi
fi

# Local project state cleanup (explicit opt-in only)
if (( wipe_data == 1 )); then
  if (( assume_yes == 0 )); then
    printf "This will permanently delete %s and %s. Continue? [y/N] " "$DATA_DIR" "$LOGS_DIR"
    read -r answer
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf "Skipping data wipe.\n"; printf "Cleanup complete.\n"; exit 0; }
  fi
  run_cmd "Removing local data/logs folders..." rm -rf "$DATA_DIR" "$LOGS_DIR"
else
  printf "Keeping local data/logs folders.\n"
fi

printf "Cleanup complete.\n"
