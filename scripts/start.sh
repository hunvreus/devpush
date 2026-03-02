#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

IMAGE_REPOSITORY="devpush-app"
IMAGE_TAG="dev"
WAIT_TIMEOUT_SECONDS="180"
RUN_MIGRATIONS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrate) RUN_MIGRATIONS=1; shift ;;
    -h|--help)
      cat <<USG
Usage: start.sh [--migrate]

Start local Kubernetes stack for /dev/push.

  --migrate   Run alembic migrations after workloads are ready
USG
      exit 0
      ;;
    *)
      printf "Unknown option: %s\n" "$1" >&2
      exit 1
      ;;
  esac
done

# Validate prerequisites
require_cmd docker
require_cmd kubectl
require_cmd helm

# Validate local files
[[ -f "$ENV_FILE" ]] || { printf "Missing env file: %s\n" "$ENV_FILE" >&2; exit 1; }
[[ -d "$CHART_DIR" ]] || { printf "Missing Helm chart: %s\n" "$CHART_DIR" >&2; exit 1; }

# Select context
select_context
kubectl cluster-info --request-timeout=20s >/dev/null

# Build image
printf "Building image %s:%s...\n" "$IMAGE_REPOSITORY" "$IMAGE_TAG"
docker build -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -f "$APP_DIR/docker/Dockerfile.app.dev" "$APP_DIR"

# Apply namespace and env secret
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
secret_manifest_file="$(mktemp)"
python3 - "$ENV_FILE" "$NAMESPACE" "${RELEASE_NAME}-env" "$secret_manifest_file" <<'PY'
import base64
import json
import re
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
namespace = sys.argv[2]
secret_name = sys.argv[3]
out_path = Path(sys.argv[4])

key_pattern = re.compile(r"^[-._a-zA-Z][-._a-zA-Z0-9]*$")

def parse_env_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1]
        value = (
            value.replace(r"\n", "\n")
            .replace(r"\r", "\r")
            .replace(r"\t", "\t")
            .replace(r"\\", "\\")
            .replace(r"\"", '"')
        )
        return value
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1]
    return value

data = {}
for line in env_path.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        continue
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].strip()
    if "=" not in stripped:
        continue
    key, raw_value = stripped.split("=", 1)
    key = key.strip()
    if not key_pattern.match(key):
        raise SystemExit(f"Invalid env key for Kubernetes Secret: {key}")
    value = parse_env_value(raw_value)
    if key == "GITHUB_APP_PRIVATE_KEY":
        value = value.replace("\\n", "\n")
    data[key] = base64.b64encode(value.encode("utf-8")).decode("ascii")

manifest = {
    "apiVersion": "v1",
    "kind": "Secret",
    "metadata": {"name": secret_name, "namespace": namespace},
    "type": "Opaque",
    "data": data,
}
out_path.write_text(json.dumps(manifest), encoding="utf-8")
PY
kubectl apply -f "$secret_manifest_file" >/dev/null
rm -f "$secret_manifest_file"

# Deploy Helm release
printf "Deploying Helm release %s...\n" "$RELEASE_NAME"
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

# Ensure Python processes reload mounted source changes in local dev.
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-app" >/dev/null
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-worker-jobs" >/dev/null
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-worker-monitor" >/dev/null
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-traefik" >/dev/null
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-loki" >/dev/null 2>&1 || true
kubectl -n "$NAMESPACE" rollout restart "deployment/${RELEASE_NAME}-alloy" >/dev/null 2>&1 || true

# Wait for app dependencies and app rollout
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-pgsql" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-redis" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-app" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-worker-jobs" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-worker-monitor" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-traefik" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-loki" --timeout="${WAIT_TIMEOUT_SECONDS}s"
kubectl -n "$NAMESPACE" rollout status "deployment/${RELEASE_NAME}-alloy" --timeout="${WAIT_TIMEOUT_SECONDS}s"

# Seed registry files into persistent data volume (legacy parity semantics)
app_pod="$(kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/component=app -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NAMESPACE" exec "$app_pod" -- sh -lc "mkdir -p /data/registry"

src_catalog="$APP_DIR/registry/catalog.json"
src_overrides="$APP_DIR/registry/overrides.json"
dst_catalog="/data/registry/catalog.json"
dst_overrides="/data/registry/overrides.json"

if kubectl -n "$NAMESPACE" exec "$app_pod" -- sh -lc "[ ! -f '$dst_catalog' ]" >/dev/null 2>&1; then
  kubectl -n "$NAMESPACE" cp "$src_catalog" "${app_pod}:${dst_catalog}"
else
  src_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$src_catalog" | head -n1)"
  dst_meta="$(kubectl -n "$NAMESPACE" exec "$app_pod" -- sh -lc "cat '$dst_catalog' 2>/dev/null" || true)"
  dst_version="$(printf "%s" "$dst_meta" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  dst_source="$(printf "%s" "$dst_meta" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [[ "$dst_source" == "bundled" && -n "$src_version" ]]; then
    if [[ -z "$dst_version" ]]; then
      kubectl -n "$NAMESPACE" cp "$src_catalog" "${app_pod}:${dst_catalog}"
    else
      newest="$(printf '%s\n%s\n' "$dst_version" "$src_version" | sort -V | tail -n1)"
      if [[ "$newest" == "$src_version" && "$src_version" != "$dst_version" ]]; then
        kubectl -n "$NAMESPACE" cp "$src_catalog" "${app_pod}:${dst_catalog}"
      fi
    fi
  fi
fi

if kubectl -n "$NAMESPACE" exec "$app_pod" -- sh -lc "[ ! -f '$dst_overrides' ]" >/dev/null 2>&1; then
  kubectl -n "$NAMESPACE" cp "$src_overrides" "${app_pod}:${dst_overrides}"
fi

if (( RUN_MIGRATIONS == 1 )); then
  "$SCRIPT_DIR/db-migrate.sh"
fi

# Show local access URL(s) through Traefik NodePort
traefik_node_port="$(kubectl -n "$NAMESPACE" get svc traefik -o jsonpath='{.spec.ports[?(@.name=="web")].nodePort}')"
traefik_node_ip="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')"

printf "Traefik NodePort: %s\n" "$traefik_node_port"
printf "App URL (host): http://localhost:%s\n" "$traefik_node_port"
printf "App URL (node): http://%s:%s\n" "$traefik_node_ip" "$traefik_node_port"
