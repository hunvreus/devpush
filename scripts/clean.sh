#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<USG
Usage: clean.sh [--all] [--yes] [-h|--help]

Clean Kubernetes resources used by local /dev/push.

  (default)      Remove stale migration jobs/pods only
  --all          Uninstall Helm release and delete local state resources
  --yes, -y      Skip confirmation prompt for --all
  -h, --help     Show this help
USG
  exit 0
}

clean_all=0
yes_flag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) clean_all=1; shift ;;
    --yes|-y) yes_flag=1; shift ;;
    -h|--help) usage ;;
    *) printf "Unknown option: %s\n" "$1" >&2; usage ;;
  esac
done

require_cmd kubectl
require_cmd helm
select_context

if (( clean_all == 0 )); then
  kubectl -n "$NAMESPACE" delete jobs -l app.kubernetes.io/component=migrate --ignore-not-found >/dev/null 2>&1 || true
  kubectl -n "$NAMESPACE" delete pods -l app.kubernetes.io/component=migrate --ignore-not-found >/dev/null 2>&1 || true
  stale_migrate_pods=()
  while IFS= read -r pod; do
    [[ -n "$pod" ]] || continue
    stale_migrate_pods+=("$pod")
  done < <(kubectl -n "$NAMESPACE" get pods -o name 2>/dev/null | rg "${RELEASE_NAME}-migrate-" || true)
  if ((${#stale_migrate_pods[@]} > 0)); then
    kubectl -n "$NAMESPACE" delete "${stale_migrate_pods[@]}" --ignore-not-found >/dev/null 2>&1 || true
  fi
  printf "Removed stale migration jobs/pods in namespace %s.\n" "$NAMESPACE"
  exit 0
fi

if (( yes_flag == 0 )); then
  printf "This will uninstall release '%s' in namespace '%s' and delete PVC/secret resources. Continue? [y/N] " "$RELEASE_NAME" "$NAMESPACE"
  read -r ans
  [[ "$ans" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf "Aborted.\n"; exit 0; }
fi

helm -n "$NAMESPACE" uninstall "$RELEASE_NAME" >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" delete pvc pgsql-data "${RELEASE_NAME}-data" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" delete secret "${RELEASE_NAME}-env" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" delete jobs -l app.kubernetes.io/component=migrate --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" delete pods -l app.kubernetes.io/component=migrate --ignore-not-found >/dev/null 2>&1 || true

printf "Removed release resources for %s in namespace %s.\n" "$RELEASE_NAME" "$NAMESPACE"
