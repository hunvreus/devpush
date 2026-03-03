#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Start failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Parse CLI flags
usage() {
  cat <<USG
Usage: start.sh [--timeout <value>] [-v|--verbose] [-h|--help]

Start local Kubernetes stack (Colima + k3s + Helm).

  --timeout <value>  Rollout wait timeout in seconds (default: ${WAIT_TIMEOUT_SECONDS})
  -v, --verbose      Enable verbose command output
  -h, --help         Show this help
USG
  exit 0
}

timeout="$WAIT_TIMEOUT_SECONDS"
VERBOSE="${VERBOSE:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      timeout="${2:-}"
      [[ -n "$timeout" ]] || { printf "Missing value for --timeout\n" >&2; exit 1; }
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
require_cmd docker
require_cmd helm

[[ -f "$ENV_FILE" ]] || { printf "Missing env file: %s\n" "$ENV_FILE" >&2; exit 1; }
[[ -d "$CHART_DIR" ]] || { printf "Missing Helm chart: %s\n" "$CHART_DIR" >&2; exit 1; }
validate_env "$ENV_FILE"

# Create local runtime data directories and seed default registry files.
seed_local_registry_defaults() {
  install -d -m 0750 "$DATA_DIR/upload" "$DATA_DIR/registry"

  if [[ ! -f "$DATA_DIR/registry/catalog.json" ]]; then
    install -m 0640 "$APP_DIR/registry/catalog.json" "$DATA_DIR/registry/catalog.json"
  fi

  if [[ ! -f "$DATA_DIR/registry/overrides.json" ]]; then
    install -m 0640 "$APP_DIR/registry/overrides.json" "$DATA_DIR/registry/overrides.json"
  fi
}

# Seed default registry files into the shared /data PVC used by app/workers.
seed_cluster_registry_defaults() {
  local app_deployment="deployment/${RELEASE_NAME}-app"

  kubectl -n "$NAMESPACE" exec "$app_deployment" -- sh -lc 'mkdir -p /data/registry'

  if ! kubectl -n "$NAMESPACE" exec "$app_deployment" -- sh -lc 'test -s /data/registry/catalog.json'; then
    kubectl -n "$NAMESPACE" exec -i "$app_deployment" -- sh -lc 'cat > /data/registry/catalog.json' < "$DATA_DIR/registry/catalog.json"
  fi

  if ! kubectl -n "$NAMESPACE" exec "$app_deployment" -- sh -lc 'test -f /data/registry/overrides.json'; then
    kubectl -n "$NAMESPACE" exec -i "$app_deployment" -- sh -lc 'cat > /data/registry/overrides.json' < "$DATA_DIR/registry/overrides.json"
  fi
}

apply_namespace_manifest() {
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null
}

wait_rollout_quiet() {
  local deployment_name="$1"
  kubectl -n "$NAMESPACE" rollout status "deployment/${deployment_name}" --timeout="${timeout}s" >/dev/null
}

# Kubernetes preflight (deploy-only script)
printf "Kubernetes preflight\n"
run_cmd "Using kubectl context: colima..." use_colima_context
if ! wait_for_kube_api 10 2; then
  printf "Kubernetes API is not reachable.\n" >&2
  printf "Run: ./scripts/k8s-up.sh or ./scripts/k8s-recover.sh\n" >&2
  exit 1
fi
run_cmd "Kubernetes API is reachable..." true

run_cmd "Ensuring local registry defaults..." seed_local_registry_defaults

printf '\n'
# Build dev image
printf "Build dev image\n"
run_cmd_stream --indent 1 "Building image ${IMAGE_REPOSITORY}:${IMAGE_TAG}..." \
  docker build -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -f "$APP_DIR/docker/Dockerfile.app.dev" "$APP_DIR"

printf '\n'
# Prepare namespace + env secret
run_cmd_plain "Applying namespace ${NAMESPACE}..." apply_namespace_manifest
secret_manifest_file="$(mktemp)"
write_env_secret_manifest "$ENV_FILE" "$NAMESPACE" "${RELEASE_NAME}-env" "$secret_manifest_file"
run_cmd_plain "Applying env secret ${RELEASE_NAME}-env..." \
  kubectl apply --validate=false -f "$secret_manifest_file" >/dev/null
rm -f "$secret_manifest_file"

printf '\n'
# Deploy chart
printf "Deploy chart\n"
run_cmd_stream --indent 1 "Deploying Helm release ${RELEASE_NAME}..." \
  helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --create-namespace \
    -f "$CHART_DIR/values.yaml" \
    -f "$CHART_DIR/values.dev.yaml" \
    --set image.repository="$IMAGE_REPOSITORY" \
    --set image.tag="$IMAGE_TAG" \
    --set env.existingSecretName="${RELEASE_NAME}-env" \
    --set migration.enabled=false \
    --set devSource.enabled=true \
    --set devSource.hostPath="$APP_DIR/app"

printf '\n'
# Wait for workloads
printf "Wait for workloads\n"
run_cmd "Waiting for pgsql rollout..." wait_rollout_quiet "${RELEASE_NAME}-pgsql"
run_cmd "Waiting for redis rollout..." wait_rollout_quiet "${RELEASE_NAME}-redis"
run_cmd "Waiting for app rollout..." wait_rollout_quiet "${RELEASE_NAME}-app"
run_cmd "Waiting for worker-jobs rollout..." wait_rollout_quiet "${RELEASE_NAME}-worker-jobs"
run_cmd "Waiting for worker-monitor rollout..." wait_rollout_quiet "${RELEASE_NAME}-worker-monitor"
run_cmd "Waiting for traefik rollout..." wait_rollout_quiet "${RELEASE_NAME}-traefik"
run_cmd "Waiting for loki rollout..." wait_rollout_quiet "${RELEASE_NAME}-loki"
run_cmd "Waiting for alloy rollout..." wait_rollout_quiet "${RELEASE_NAME}-alloy"

printf '\n'
run_cmd_plain "Ensuring /data/registry defaults in cluster..." seed_cluster_registry_defaults

printf '\n'
printf "${CLR_GREEN}App URL: http://localhost${CLR_RESET}\n"
