#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DEVPUSH_DATA_DIR:-$APP_DIR/data}"
ENV_FILE="${DEVPUSH_ENV_FILE:-$DATA_DIR/.env}"
LOGS_DIR="${DEVPUSH_LOGS_DIR:-$APP_DIR/logs}"
CHART_DIR="$APP_DIR/helm/devpush"
NAMESPACE="${DEVPUSH_NAMESPACE:-devpush}"
RELEASE_NAME="${DEVPUSH_RELEASE_NAME:-devpush}"
IMAGE_REPOSITORY="${DEVPUSH_IMAGE_REPOSITORY:-devpush-app}"
IMAGE_TAG="${DEVPUSH_IMAGE_TAG:-dev}"
WAIT_TIMEOUT_SECONDS="${DEVPUSH_WAIT_TIMEOUT_SECONDS:-240}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  }
}

run_cmd() {
  local message="$1"
  shift
  printf "%s\n" "$message"
  "$@"
}

write_env_secret_manifest() {
  local env_file="$1"
  local namespace="$2"
  local secret_name="$3"
  local output_file="$4"

  python3 - "$env_file" "$namespace" "$secret_name" "$output_file" <<'PY'
import base64
import json
import re
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
namespace = sys.argv[2]
secret_name = sys.argv[3]
output_path = Path(sys.argv[4])
key_pattern = re.compile(r"^[-._a-zA-Z][-._a-zA-Z0-9]*$")

def parse_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1]
        return (
            value.replace(r"\n", "\n")
            .replace(r"\r", "\r")
            .replace(r"\t", "\t")
            .replace(r"\\", "\\")
            .replace(r"\"", '"')
        )
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1]
    return value

data = {}
for line in env_path.read_text(encoding="utf-8").splitlines():
    item = line.strip()
    if not item or item.startswith("#"):
        continue
    if item.startswith("export "):
        item = item[len("export "):].strip()
    if "=" not in item:
        continue
    key, raw_value = item.split("=", 1)
    key = key.strip()
    if not key_pattern.match(key):
        continue
    value = parse_value(raw_value)
    data[key] = base64.b64encode(value.encode("utf-8")).decode("ascii")

manifest = {
    "apiVersion": "v1",
    "kind": "Secret",
    "metadata": {"name": secret_name, "namespace": namespace},
    "type": "Opaque",
    "data": data,
}
output_path.write_text(json.dumps(manifest), encoding="utf-8")
PY
}

colima_running() {
  colima status >/dev/null 2>&1
}

ensure_colima_kubernetes() {
  # Start Colima with Kubernetes; no-op if already running.
  run_cmd "Starting Colima Kubernetes..." colima start --kubernetes >/dev/null
}

use_colima_context() {
  kubectl config use-context colima >/dev/null
}

wait_for_kube_api() {
  local retries="${1:-45}"
  local delay_seconds="${2:-2}"
  local attempt=1

  while (( attempt <= retries )); do
    if kubectl cluster-info --request-timeout=10s >/dev/null 2>&1; then
      return 0
    fi
    printf "Kubernetes API not ready (attempt %d/%d); retrying in %ss...\n" "$attempt" "$retries" "$delay_seconds"
    sleep "$delay_seconds"
    ((attempt++))
  done

  printf "Kubernetes API is unreachable after %d attempts.\n" "$retries" >&2
  return 1
}
