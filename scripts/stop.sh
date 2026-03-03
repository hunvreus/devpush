#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Stop failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Parse CLI flags
usage() {
  cat <<USG
Usage: stop.sh [--components <csv>] [--hard] [--timeout <value>] [-v|--verbose] [-h|--help]

Stop local Kubernetes stack workloads in namespace ${NAMESPACE}.

  --components <csv>  Comma-separated deployments to stop: app,pgsql,redis,worker-jobs,worker-monitor,traefik,loki,alloy
  --hard              Force-delete lingering pods for selected deployments (or all when no components are specified)
  --timeout <value>   Kubernetes API wait timeout in seconds (default: 60)
  -v, --verbose       Enable verbose command output
  -h, --help          Show this help
USG
  exit 0
}

timeout_seconds=60
hard_mode=0
components_csv=""
VERBOSE="${VERBOSE:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --components)
      components_csv="${2:-}"
      [[ -n "$components_csv" ]] || { printf "Missing value for --components\n" >&2; exit 1; }
      shift 2
      ;;
    --hard)
      hard_mode=1
      shift
      ;;
    --timeout)
      timeout_seconds="${2:-}"
      [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || { printf "Invalid --timeout value: %s\n" "${timeout_seconds}" >&2; exit 1; }
      shift 2
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

# Validate local prerequisites
require_cmd colima
require_cmd kubectl

KNOWN_COMPONENTS=(app pgsql redis worker-jobs worker-monitor traefik loki alloy)

component_is_known() {
  local target="$1"
  local component
  for component in "${KNOWN_COMPONENTS[@]}"; do
    [[ "$component" == "$target" ]] && return 0
  done
  return 1
}

TARGET_COMPONENTS=()
if [[ -n "$components_csv" ]]; then
  IFS=',' read -ra parsed_components <<< "$components_csv"
  for component in "${parsed_components[@]}"; do
    component="${component// /}"
    [[ -n "$component" ]] || continue
    if ! component_is_known "$component"; then
      printf "Invalid component: %s\n" "$component" >&2
      exit 1
    fi
    TARGET_COMPONENTS+=("$component")
  done
  ((${#TARGET_COMPONENTS[@]} > 0)) || { printf "No valid component provided in --components\n" >&2; exit 1; }
else
  TARGET_COMPONENTS=("${KNOWN_COMPONENTS[@]}")
fi

# Connect to Kubernetes (Colima + k3s)
printf "Connect to Kubernetes (Colima + k3s)\n"
if ! colima_running; then
  printf "%s Colima is not running. Nothing to stop.\n" "$CHILD_MARK"
  exit 0
fi
run_cmd "Using kubectl context: colima..." use_colima_context
wait_retries=$((timeout_seconds / 2))
(( wait_retries < 1 )) && wait_retries=1
run_cmd "Waiting for Kubernetes API..." wait_for_kube_api "$wait_retries" 2

# Scale selected deployments down to 0 replicas.
scale_target_deployments_down() {
  local deployment
  local component
  for component in "${TARGET_COMPONENTS[@]}"; do
    deployment="${RELEASE_NAME}-${component}"
    if kubectl -n "$NAMESPACE" get deployment "$deployment" >/dev/null 2>&1; then
      kubectl -n "$NAMESPACE" scale deployment "$deployment" --replicas=0 >/dev/null
    else
      printf "%s Deployment %s not found (skipped).\n" "$CHILD_MARK" "$deployment"
    fi
  done
}

wait_target_rollout_down() {
  local deployment
  local component
  for component in "${TARGET_COMPONENTS[@]}"; do
    deployment="${RELEASE_NAME}-${component}"
    if kubectl -n "$NAMESPACE" get deployment "$deployment" >/dev/null 2>&1; then
      kubectl -n "$NAMESPACE" rollout status "deployment/${deployment}" --timeout="${timeout_seconds}s" >/dev/null
    fi
  done
}

verify_target_deployments_stopped() {
  local deployment replicas ready available
  local component
  for component in "${TARGET_COMPONENTS[@]}"; do
    deployment="${RELEASE_NAME}-${component}"
    if ! kubectl -n "$NAMESPACE" get deployment "$deployment" >/dev/null 2>&1; then
      continue
    fi

    replicas="$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.status.replicas}' 2>/dev/null || true)"
    ready="$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
    available="$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)"

    replicas="${replicas:-0}"
    ready="${ready:-0}"
    available="${available:-0}"

    if [[ "$replicas" != "0" || "$ready" != "0" || "$available" != "0" ]]; then
      return 1
    fi
  done
  return 0
}

force_delete_lingering_pods() {
  local component deployment
  local -a pods=()
  local pod

  for component in "${TARGET_COMPONENTS[@]}"; do
    deployment="${RELEASE_NAME}-${component}"
    while IFS= read -r pod; do
      [[ -n "$pod" ]] || continue
      pods+=("$pod")
    done < <(kubectl -n "$NAMESPACE" get pods -o name 2>/dev/null | awk -v dep="$deployment" '$0 ~ "^pod/" dep "-" { print $0 }')
  done

  if ((${#pods[@]} == 0)); then
    printf "%s No lingering pods found.\n" "$CHILD_MARK"
    return 0
  fi

  kubectl -n "$NAMESPACE" delete --force --grace-period=0 "${pods[@]}" >/dev/null
}

printf '\n'
run_cmd_plain "Scaling deployments down..." scale_target_deployments_down
run_cmd "Waiting for deployments to scale down..." wait_target_rollout_down

if ! verify_target_deployments_stopped; then
  if (( hard_mode == 1 )); then
    run_cmd "Force-deleting lingering pods..." force_delete_lingering_pods
  else
    printf "Some workloads are still running. Re-run with --hard to force stop.\n" >&2
    exit 1
  fi
fi

if ! verify_target_deployments_stopped; then
  printf "Some selected workloads are still running after stop.\n" >&2
  exit 1
fi

printf '\n'
printf "${CLR_GREEN}Stack stopped in namespace ${NAMESPACE}.${CLR_RESET}\n"
