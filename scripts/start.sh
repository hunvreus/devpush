#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Start failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Validate local prerequisites
require_cmd colima
require_cmd kubectl
require_cmd docker
require_cmd helm

[[ -f "$ENV_FILE" ]] || { printf "Missing env file: %s\n" "$ENV_FILE" >&2; exit 1; }
[[ -d "$CHART_DIR" ]] || { printf "Missing Helm chart: %s\n" "$CHART_DIR" >&2; exit 1; }

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

printf "# Bootstrap Kubernetes (Colima + k3s)\n"
run_cmd "Ensuring Colima is running with Kubernetes..." ensure_colima_kubernetes
run_cmd "Using kubectl context: colima..." use_colima_context
run_cmd "Waiting for Kubernetes API..." wait_for_kube_api 45 2

printf '\n'
printf "# Prepare local data defaults\n"
run_cmd "Ensuring local registry defaults..." seed_local_registry_defaults

printf '\n'
printf "# Build dev image\n"
run_cmd "Building image ${IMAGE_REPOSITORY}:${IMAGE_TAG}..." \
  docker build -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -f "$APP_DIR/docker/Dockerfile.app.dev" "$APP_DIR"

printf '\n'
printf "# Prepare namespace + env secret\n"
run_cmd "Applying namespace ${NAMESPACE}..." \
  sh -lc "kubectl create namespace '$NAMESPACE' --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null"
secret_manifest_file="$(mktemp)"
write_env_secret_manifest "$ENV_FILE" "$NAMESPACE" "${RELEASE_NAME}-env" "$secret_manifest_file"
run_cmd "Applying env secret ${RELEASE_NAME}-env..." \
  kubectl apply --validate=false -f "$secret_manifest_file" >/dev/null
rm -f "$secret_manifest_file"

printf '\n'
printf "# Deploy chart\n"
run_cmd "Deploying Helm release ${RELEASE_NAME}..." \
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
printf "# Wait for workloads\n"
run_cmd "Waiting for pgsql rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-pgsql" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for redis rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-redis" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for app rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-app" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for worker-jobs rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-worker-jobs" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for worker-monitor rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-worker-monitor" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for traefik rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-traefik" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for loki rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-loki" --timeout="${WAIT_TIMEOUT_SECONDS}s"
run_cmd "Waiting for alloy rollout..." kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-alloy" --timeout="${WAIT_TIMEOUT_SECONDS}s"

printf '\n'
printf "# Seed cluster registry defaults\n"
run_cmd "Ensuring /data/registry defaults in cluster..." seed_cluster_registry_defaults

printf '\n'
printf "App URL: http://localhost\n"
