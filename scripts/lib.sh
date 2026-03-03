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

if [[ -t 1 ]]; then
  CLR_GREEN="$(printf '\033[32m')"
  CLR_YELLOW="$(printf '\033[33m')"
  CLR_RED="$(printf '\033[31m')"
  CLR_DIM="$(printf '\033[2m')"
  CLR_RESET="$(printf '\033[0m')"
else
  CLR_GREEN=""
  CLR_YELLOW=""
  CLR_RED=""
  CLR_DIM=""
  CLR_RESET=""
fi

CHILD_MARK="-"
case "${LC_ALL:-${LANG:-}}" in
  *UTF-8*|*utf8*) CHILD_MARK="└─" ;;
esac

SPINNER_FRAMES=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
SPINNER_DELAY_SECONDS=0.08

_spinner() {
  local pid="$1"
  local message="$2"
  local frame_index=0
  local frame_count="${#SPINNER_FRAMES[@]}"

  while kill -0 "$pid" >/dev/null 2>&1; do
    printf "\r${CLR_DIM}%s${CLR_RESET} %s ${CLR_DIM}[%s]${CLR_RESET}" \
      "$CHILD_MARK" "$message" "${SPINNER_FRAMES[$frame_index]}"
    frame_index=$(( (frame_index + 1) % frame_count ))
    sleep "$SPINNER_DELAY_SECONDS"
  done
}

run_cmd() {
  local message="$1"
  shift

  if [[ $# -eq 0 ]]; then
    printf "run_cmd requires a command for: %s\n" "$message" >&2
    return 1
  fi

  if [[ ! -t 1 ]]; then
    printf "%s %s\n" "$CHILD_MARK" "$message"
    "$@"
    return $?
  fi

  local cmd_log
  cmd_log="$(mktemp)"

  "$@" >"$cmd_log" 2>&1 &
  local cmd_pid="$!"
  _spinner "$cmd_pid" "$message"

  local status=0
  wait "$cmd_pid" || status=$?
  printf "\r\033[K"

  if (( status == 0 )); then
    printf "${CLR_DIM}%s${CLR_RESET} %s ${CLR_GREEN}✔${CLR_RESET}\n" "$CHILD_MARK" "$message"
    rm -f "$cmd_log"
    return 0
  fi

  printf "${CLR_DIM}%s${CLR_RESET} %s ${CLR_RED}✖${CLR_RESET}\n" "$CHILD_MARK" "$message"
  if [[ -s "$cmd_log" ]]; then
    while IFS= read -r line; do
      printf "${CLR_DIM}   %s${CLR_RESET}\n" "$line" >&2
    done < "$cmd_log"
  fi
  rm -f "$cmd_log"
  return "$status"
}

run_cmd_stream() {
  local indent_level=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --indent)
        indent_level="${2:-}"
        [[ "$indent_level" =~ ^[0-9]+$ ]] || {
          printf "run_cmd_stream --indent expects a non-negative integer\n" >&2
          return 1
        }
        shift 2
        ;;
      *)
        break
        ;;
    esac
  done

  local message="$1"
  shift

  if [[ $# -eq 0 ]]; then
    printf "run_cmd_stream requires a command for: %s\n" "$message" >&2
    return 1
  fi

  local indent_prefix=""
  indent_prefix="$(printf '%*s' "$((indent_level * 3))" '')"

  printf "${CLR_DIM}%s${CLR_RESET} %s\n" "$CHILD_MARK" "$message"

  local status=0
  local had_errexit=0
  [[ $- == *e* ]] && had_errexit=1
  set +e
  "$@" 2>&1 | while IFS= read -r line; do
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -z "$line" ]]; then
      continue
    fi
    if [[ -t 1 ]]; then
      printf "${CLR_DIM}%s%s${CLR_RESET}\n" "$indent_prefix" "$line"
    else
      printf "%s%s\n" "$indent_prefix" "$line"
    fi
  done
  status=${PIPESTATUS[0]}
  (( had_errexit == 1 )) && set -e

  if (( status == 0 )); then
    printf "${CLR_DIM}%s${CLR_RESET} %s ${CLR_GREEN}✔${CLR_RESET}\n" "$CHILD_MARK" "$message"
    return 0
  fi
  printf "${CLR_DIM}%s${CLR_RESET} %s ${CLR_RED}✖${CLR_RESET}\n" "$CHILD_MARK" "$message"
  return "$status"
}

run_cmd_plain() {
  local message="$1"
  shift

  if [[ $# -eq 0 ]]; then
    printf "run_cmd_plain requires a command for: %s\n" "$message" >&2
    return 1
  fi

  if [[ ! -t 1 ]]; then
    printf "%s\n" "$message"
    "$@"
    return $?
  fi

  local cmd_log
  cmd_log="$(mktemp)"

  "$@" >"$cmd_log" 2>&1 &
  local cmd_pid="$!"
  local frame_index=0
  local frame_count="${#SPINNER_FRAMES[@]}"
  while kill -0 "$cmd_pid" >/dev/null 2>&1; do
    printf "\r%s ${CLR_DIM}[%s]${CLR_RESET}" "$message" "${SPINNER_FRAMES[$frame_index]}"
    frame_index=$(( (frame_index + 1) % frame_count ))
    sleep "$SPINNER_DELAY_SECONDS"
  done

  local status=0
  wait "$cmd_pid" || status=$?
  printf "\r\033[K"

  if (( status == 0 )); then
    printf "%s ${CLR_GREEN}✔${CLR_RESET}\n" "$message"
    rm -f "$cmd_log"
    return 0
  fi

  printf "%s ${CLR_RED}✖${CLR_RESET}\n" "$message"
  if [[ -s "$cmd_log" ]]; then
    while IFS= read -r line; do
      printf "${CLR_DIM}   %s${CLR_RESET}\n" "$line" >&2
    done < "$cmd_log"
  fi
  rm -f "$cmd_log"
  return "$status"
}

read_env_value() {
  local env_file="$1"
  local key="$2"

  python3 - "$env_file" "$key" <<'PY'
import re
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
target_key = sys.argv[2]
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

if not env_path.exists():
    sys.exit(0)

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
    if key == target_key:
        print(parse_value(raw_value), end="")
        sys.exit(0)
PY
}

validate_env() {
  local env_file="$1"
  [[ -f "$env_file" ]] || { printf "Not found: %s\n" "$env_file" >&2; return 1; }

  local required=(
    APP_HOSTNAME
    DEPLOY_DOMAIN
    EMAIL_SENDER_ADDRESS
    GITHUB_APP_ID
    GITHUB_APP_NAME
    GITHUB_APP_PRIVATE_KEY
    GITHUB_APP_WEBHOOK_SECRET
    GITHUB_APP_CLIENT_ID
    GITHUB_APP_CLIENT_SECRET
    SECRET_KEY
    ENCRYPTION_KEY
    POSTGRES_PASSWORD
  )

  local missing=()
  local key value
  for key in "${required[@]}"; do
    value="$(read_env_value "$env_file" "$key")"
    [[ -n "$value" ]] || missing+=("$key")
  done

  local resend_key smtp_host smtp_username smtp_password
  resend_key="$(read_env_value "$env_file" RESEND_API_KEY)"
  smtp_host="$(read_env_value "$env_file" SMTP_HOST)"
  smtp_username="$(read_env_value "$env_file" SMTP_USERNAME)"
  smtp_password="$(read_env_value "$env_file" SMTP_PASSWORD)"

  if [[ -n "$resend_key" ]]; then
    :
  elif [[ -n "$smtp_host" && -n "$smtp_username" && -n "$smtp_password" ]]; then
    :
  else
    missing+=("RESEND_API_KEY or SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD")
  fi

  if ((${#missing[@]})); then
    local joined
    joined="$(printf "%s, " "${missing[@]}")"
    joined="${joined%, }"
    printf "Missing values in %s: %s\n" "$env_file" "$joined" >&2
    return 1
  fi
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
  colima start --kubernetes >/dev/null
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
