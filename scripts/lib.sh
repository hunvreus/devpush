#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DEVPUSH_DATA_DIR:-$APP_DIR/data}"
ENV_FILE="${DEVPUSH_ENV_FILE:-$DATA_DIR/.env}"
CHART_DIR="$APP_DIR/helm/devpush"

NAMESPACE="${DEVPUSH_NAMESPACE:-devpush}"
RELEASE_NAME="${DEVPUSH_RELEASE_NAME:-devpush}"
KUBE_CONTEXT="${DEVPUSH_KUBE_CONTEXT:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  }
}

select_context() {
  if [[ -n "$KUBE_CONTEXT" ]]; then
    kubectl config use-context "$KUBE_CONTEXT" >/dev/null
    return
  fi

  current_context="$(kubectl config current-context 2>/dev/null || true)"
  if [[ -n "$current_context" ]]; then
    return
  fi

  if kubectl config get-contexts -o name 2>/dev/null | rg -x "colima" >/dev/null 2>&1; then
    kubectl config use-context colima >/dev/null
    return
  fi

  printf "No active Kubernetes context found.\n" >&2
  printf "Start Colima Kubernetes and set context, e.g.:\n" >&2
  printf "  colima start --kubernetes\n" >&2
  printf "  kubectl config use-context colima\n" >&2
  exit 1
}
