#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$LIB_DIR/.." && pwd)"

# Colors and formatting
if [[ -t 1 ]]; then
  RED="$(printf '\033[31m')"; GRN="$(printf '\033[32m')"; YEL="$(printf '\033[33m')"; BLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; NC="$(printf '\033[0m')"
else
  RED=""; GRN=""; YEL=""; BLD=""; DIM=""; NC=""
fi

is_utf8(){ case "${LC_ALL:-${LANG:-}}" in *UTF-8*|*utf8*) return 0;; *) return 1;; esac; }
CHILD_MARK="-"
if [[ -t 1 ]] && is_utf8; then CHILD_MARK="└─"; fi

err(){ printf "%b\n" "${RED}Error:${NC} $*" >&2; }
ok(){ printf "%b\n" "${GRN}Success:${NC} $*"; }
info(){ printf "%s\n" "$*"; }

# Verbosity level
VERBOSE="${VERBOSE:-0}"

# Log files
CMD_LOG="${TMPDIR:-/tmp}/devpush-cmd.$$.log"
: "${SCRIPT_ERR_LOG:=/tmp/$(basename "$0" .sh)_error.log}"

# Detect environment (production or development)
ENVIRONMENT="${DEVPUSH_ENV:-}"
if [[ -z "$ENVIRONMENT" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    ENVIRONMENT="development"
  else
    ENVIRONMENT="production"
  fi
fi

# Application and data paths
if [[ "$ENVIRONMENT" == "production" ]]; then
  APP_DIR="${DEVPUSH_APP_DIR:-/opt/devpush}"
  DATA_DIR="${DEVPUSH_DATA_DIR:-/var/lib/devpush}"
else
  APP_DIR="${DEVPUSH_APP_DIR:-$PROJECT_ROOT}"
  DATA_DIR="${DEVPUSH_DATA_DIR:-$APP_DIR/data}"
fi

# Environment file, config file, and version file
ENV_FILE="$DATA_DIR/.env"
CONFIG_FILE="$DATA_DIR/config.json"
VERSION_FILE="$DATA_DIR/version.json"

export ENVIRONMENT APP_DIR DATA_DIR ENV_FILE CONFIG_FILE VERSION_FILE

# Spinner for long-running commands
spinner() {
  local pid="$1"
  local delay=0.1
  local frames='-|\/'
  local i=0
  { tput civis 2>/dev/null || printf "\033[?25l"; } 2>/dev/null
  while kill -0 "$pid" 2>/dev/null; do
    i=$(((i + 1) % 4))
    printf "\r%s [%c]\033[K" "${SPIN_PREFIX:-}" "${frames:$i:1}"
    sleep "$delay"
  done
  { tput cnorm 2>/dev/null || printf "\033[?25h"; } 2>/dev/null
}

# Run command and bail out on failure
run_cmd() {
  local msg="$1"; shift
  local cmd=("$@")

  if ((VERBOSE == 1)); then
    printf "%s\n" "$msg"
    "${cmd[@]}"
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
      err "Failed running: ${cmd[*]}"
      exit $exit_code
    else
        printf "%b\n" "${GRN}Done ✔${NC}"
    fi
  else
    : >"$CMD_LOG"
    "${cmd[@]}" >"$CMD_LOG" 2>&1 &
    local pid=$!
    SPIN_PREFIX="$msg"
    spinner "$pid"
    printf "\r\033[K"
    local saved_trap saved_e
    saved_trap="$(trap -p ERR 2>/dev/null || echo '')"
    saved_e="$-"
    trap - ERR 2>/dev/null || true
    set +e
    wait "$pid"
    local exit_code=$?
    if [[ "$saved_e" == *e* ]]; then
      set -e
    else
      set +e
    fi
    if [[ -n "$saved_trap" ]]; then
      if ! eval "$saved_trap" 2>/dev/null; then
        err "Failed to restore ERR trap - error handling may be compromised"
      fi
    fi
    if [[ $exit_code -ne 0 ]]; then
      printf "%b\n" "$SPIN_PREFIX ${RED}✖${NC}"
      printf '\n'
      err "Failed. Command output:"
      if [[ -s "$CMD_LOG" ]]; then
        if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
          sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" | tee -a "$SCRIPT_ERR_LOG" >&2
        else
          sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" >&2
        fi
      else
        if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
            printf "%b\n" "  ${DIM}(no output captured)${NC}" | tee -a "$SCRIPT_ERR_LOG" >&2
        else
            printf "%b\n" "  ${DIM}(no output captured)${NC}" >&2
        fi
      fi
      printf '\n'
      rm -f "$CMD_LOG" 2>/dev/null || true
      exit $exit_code
    else
      printf "%b\n" "$SPIN_PREFIX ${GRN}✔${NC}"
      rm -f "$CMD_LOG" 2>/dev/null || true
    fi
  fi
}

# Same as run_cmd but returns non-zero instead of exiting
run_cmd_try() {
  local msg="$1"; shift
  local cmd=("$@")

  if ((VERBOSE == 1)); then
    printf "%s\n" "$msg"
    "${cmd[@]}"
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
      err "Failed running: ${cmd[*]}"
      return $exit_code
    else
      printf "%b\n" "${GRN}Done ✔${NC}"
      return 0
    fi
  else
    : >"$CMD_LOG"
    "${cmd[@]}" >"$CMD_LOG" 2>&1 &
    local pid=$!
    SPIN_PREFIX="$msg"
    spinner "$pid"
    printf "\r\033[K"
    local saved_trap saved_e
    saved_trap="$(trap -p ERR 2>/dev/null || echo '')"
    saved_e="$-"
    trap - ERR 2>/dev/null || true
    set +e
    wait "$pid"
    local exit_code=$?
    if [[ "$saved_e" == *e* ]]; then
      set -e
    else
      set +e
    fi
    if [[ -n "$saved_trap" ]]; then
      if ! eval "$saved_trap" 2>/dev/null; then
        err "Failed to restore ERR trap - error handling may be compromised"
      fi
    fi
    if [[ $exit_code -ne 0 ]]; then
      printf "%b\n" "$SPIN_PREFIX ${RED}✖${NC}"
      printf '\n'
      err "Failed. Command output:"
      if [[ -s "$CMD_LOG" ]]; then
        if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
          sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" | tee -a "$SCRIPT_ERR_LOG" >&2
        else
          sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" >&2
        fi
      else
        if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
          printf "%b\n" "  ${DIM}(no output captured)${NC}" | tee -a "$SCRIPT_ERR_LOG" >&2
        else
          printf "%b\n" "  ${DIM}(no output captured)${NC}" >&2
        fi
      fi
      printf '\n'
      rm -f "$CMD_LOG" 2>/dev/null || true
      return $exit_code
    else
      printf "%b\n" "$SPIN_PREFIX ${GRN}✔${NC}"
      rm -f "$CMD_LOG" 2>/dev/null || true
      return 0
    fi
  fi
}

# Read a value from .env-style file
read_env_value(){
  local env_file="$1"; local key="$2"
  [[ -f "$env_file" ]] || return 0
  awk -F= -v k="$key" '$1==k{sub(/^[^=]*=/,""); print}' "$env_file" | sed 's/^"\|"$//g' | head -n1
}

# Get a value from a JSON file
json_get() {
  local expr="$1"
  local file="$2"
  local default="${3-}"

  if [[ "${expr:0:1}" != "." && "$expr" != "@" ]]; then
    expr=".$expr"
  fi

  if [[ ! -f "$file" ]]; then
    if [[ $# -ge 3 ]]; then
      printf "%s\n" "$default"
      return 0
    fi
    return 1
  fi

  local value
  value=$(jq -e -r "$expr // empty" "$file" 2>/dev/null || true)
  if [[ -n "$value" ]]; then
    printf "%s\n" "$value"
    return 0
  fi

  if [[ $# -ge 3 ]]; then
    printf "%s\n" "$default"
    return 0
  fi

  return 1
}

# Update a JSON file
json_upsert() {
  local file="$1"
  shift

  if (( $# % 2 != 0 )); then
    err "json_upsert expects key/value pairs"
    return 1
  fi

  local dir tmp
  dir="$(dirname "$file")"
  install -d -m 0750 "$dir" >/dev/null 2>&1 || true
  tmp="$file.tmp"

  local jq_args=()
  local filter='(. // {}) as $base | $base + {'
  local first=1

  while [[ $# -gt 0 ]]; do
    local key="$1"
    local value="$2"
    shift 2

    if (( first )); then
      first=0
    else
      filter+=", "
    fi

    local arg_type="--arg"
    local processed="$value"
    if [[ "$value" =~ ^@json:(.*)$ ]]; then
      arg_type="--argjson"
      processed="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^-?[0-9]+$ || "$value" == "true" || "$value" == "false" ]]; then
      arg_type="--argjson"
    fi

    jq_args+=("$arg_type" "$key" "$processed")
    filter+="\"${key}\": \$${key}"
  done

  filter+='}'

  if [[ -f "$file" ]]; then
    jq "${jq_args[@]}" "$filter" "$file" | jq '.' >"$tmp"
  else
    jq -n "${jq_args[@]}" "$filter" | jq '.' >"$tmp"
  fi

  mv "$tmp" "$file"
  chmod 0644 "$file" >/dev/null 2>&1 || true
}

# Validate environment variables
validate_env(){
  local env_file="$1"
  local provider="${2:-default}"

  [[ -f "$env_file" ]] || { err "Not found: $env_file"; exit 1; }

  # Core environment variables
  local required=(
    APP_HOSTNAME
    DEPLOY_DOMAIN
    EMAIL_SENDER_ADDRESS
    RESEND_API_KEY
    GITHUB_APP_ID
    GITHUB_APP_NAME
    GITHUB_APP_PRIVATE_KEY
    GITHUB_APP_WEBHOOK_SECRET
    GITHUB_APP_CLIENT_ID
    GITHUB_APP_CLIENT_SECRET
    SECRET_KEY
    ENCRYPTION_KEY
    POSTGRES_PASSWORD
    SERVER_IP
  )

  local missing=()
  local key value

  for key in "${required[@]}"; do
    value="$(read_env_value "$env_file" "$key")"
    [[ -n "$value" ]] || missing+=("$key")
  done

  # Optional SSL provider environment variables
  if [[ "$ENVIRONMENT" == "production" ]]; then
    local email="${LE_EMAIL:-$(read_env_value "$env_file" LE_EMAIL)}"
    [[ -n "$email" ]] || missing+=("LE_EMAIL")

    case "$provider" in
      default)
        ;;
      cloudflare)
        [[ -n "$(read_env_value "$env_file" CF_DNS_API_TOKEN)" ]] || missing+=("CF_DNS_API_TOKEN")
        ;;
      route53)
        for key in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION; do
          [[ -n "$(read_env_value "$env_file" "$key")" ]] || missing+=("$key")
        done
        ;;
      gcloud)
        [[ -n "$(read_env_value "$env_file" GCE_PROJECT)" ]] || missing+=("GCE_PROJECT")
        [[ -f $DATA_DIR/gcloud-sa.json ]] || missing+=("gcloud-sa.json")
        ;;
      digitalocean)
        [[ -n "$(read_env_value "$env_file" DO_AUTH_TOKEN)" ]] || missing+=("DO_AUTH_TOKEN")
        ;;
      azure)
        for key in AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID AZURE_RESOURCE_GROUP; do
          [[ -n "$(read_env_value "$env_file" "$key")" ]] || missing+=("$key")
        done
        ;;
      *)
        err "Unknown SSL provider: $provider"
        exit 1
        ;;
    esac
  fi

  if ((${#missing[@]})); then
    local joined
    joined="$(printf "%s, " "${missing[@]}")"
    joined="${joined%, }"
    err "Missing values in $env_file: $joined"
    exit 1
  fi
}

# Returns 0 when setup_complete flag is true
is_setup_complete() {
  [[ "$(json_get setup_complete "$CONFIG_FILE" false)" == "true" ]]
}

# Service user (used for ownership + container UID/GID)
SERVICE_USER="${DEVPUSH_SERVICE_USER:-}"
SERVICE_UID="${SERVICE_UID:-}"
SERVICE_GID="${SERVICE_GID:-}"

# Determine default service user
default_service_user() {
  if [[ -n "$SERVICE_USER" ]]; then
    printf "%s\n" "$SERVICE_USER"
    return
  fi
  if [[ -n "${DEVPUSH_SERVICE_USER:-}" ]]; then
    printf "%s\n" "$DEVPUSH_SERVICE_USER"
    return
  fi

  if [[ "$ENVIRONMENT" == "production" ]]; then
    printf "devpush\n"
  else
    if command -v id >/dev/null 2>&1; then
      id -un
    else
      printf "%s\n" "${USER:-devpush}"
    fi
  fi
}

# Ensure service UID/GID are set
ensure_service_ids() {
  local config_user config_uid config_gid
  config_user="$(json_get service_user "$CONFIG_FILE" "" || true)"
  config_uid="$(json_get service_uid "$CONFIG_FILE" "" || true)"
  config_gid="$(json_get service_gid "$CONFIG_FILE" "" || true)"

  local candidate="${SERVICE_USER:-${DEVPUSH_SERVICE_USER:-}}"
  if [[ -z "$candidate" && -n "$config_user" ]]; then
    candidate="$config_user"
  fi
  if [[ -z "$candidate" ]]; then
    candidate="$(default_service_user)"
  fi

  local uid="" gid=""
  if [[ -n "$config_uid" && -n "$config_gid" && "$candidate" == "$config_user" ]]; then
    uid="$config_uid"
    gid="$config_gid"
  fi

  if [[ -z "$uid" || -z "$gid" ]]; then
    if id -u "$candidate" >/dev/null 2>&1; then
      uid="$(id -u "$candidate")"
      gid="$(id -g "$candidate")"
    else
      if [[ "$ENVIRONMENT" == "production" ]]; then
        err "Service user '$candidate' not found. Has install.sh been run?"
        exit 1
      fi
      candidate="$(id -un)"
      uid="$(id -u)"
      gid="$(id -g)"
    fi
  fi

  SERVICE_USER="$candidate"
  SERVICE_UID="$uid"
  SERVICE_GID="$gid"
  export SERVICE_USER SERVICE_UID SERVICE_GID
}

# Persist service UID/GID to config.json
persist_service_ids() {
  local uid="$1"
  local gid="$2"
  local user="$3"

  [[ -n "$uid" && -n "$gid" ]] || return 0

  if [[ -z "$user" ]]; then
    user="$(default_service_user)"
  fi

  json_upsert "$CONFIG_FILE" \
    service_user "$user" \
    service_uid "@json:$uid" \
    service_gid "@json:$gid"
}

# Resolve SSL provider from env/config/default
get_ssl_provider() {
  if [[ -n "${SSL_PROVIDER:-}" ]]; then
    printf "%s\n" "$SSL_PROVIDER"
    return
  fi
  local provider
  provider="$(json_get ssl_provider "$CONFIG_FILE" "")"
  if [[ -n "$provider" ]]; then
    printf "%s\n" "$provider"
    return
  fi
  printf "default\n"
}

# Persist SSL provider choice to config.json
persist_ssl_provider() {
  local provider="$1"
  json_upsert "$CONFIG_FILE" ssl_provider "$provider"
}

# Ensure traefik/acme.json exists with strict perms
ensure_acme_json() {
  install -d -m 0755 "$DATA_DIR/traefik" >/dev/null 2>&1 || true
  touch "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
  chmod 600 "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
}

# Docker compose variables
COMPOSE_BIN=()
COMPOSE_ARGS=()
COMPOSE_ENV=()
COMPOSE_BASE=()

# Detect compose command (`docker compose` preferred)
detect_compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
    return 0
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
    return 0
  fi
  return 1
}

# Ensure compose command is detected
ensure_compose_cmd() {
  if ((${#COMPOSE_BIN[@]} == 0)); then
    if ! detect_compose_cmd; then
      err "Neither 'docker compose' nor 'docker-compose' is available. Install Docker v20.10+ or docker-compose."
      exit 1
    fi
  fi
}

# Build compose arguments for stack/setup modes
compose_args() {
  local mode="${1:-run}"
  local ssl="${2:-default}"

  if [[ "$mode" == "stack" || "$mode" == "app" ]]; then
    mode="run"
  fi

  COMPOSE_ARGS=(-p devpush)
  COMPOSE_ENV=()

  if [[ "$mode" == "setup" ]]; then
    COMPOSE_ARGS+=(-f "$APP_DIR/compose/setup.yml")
    if [[ "$ENVIRONMENT" == "development" ]]; then
      COMPOSE_ARGS+=(-f "$APP_DIR/compose/setup.override.dev.yml")
    fi
  else
    COMPOSE_ARGS+=(-f "$APP_DIR/compose/run.yml")
    if [[ "$ENVIRONMENT" == "production" ]]; then
      COMPOSE_ARGS+=(-f "$APP_DIR/compose/run.override.yml")
      COMPOSE_ARGS+=(-f "$APP_DIR/compose/ssl-${ssl}.yml")
    else
      COMPOSE_ARGS+=(-f "$APP_DIR/compose/run.override.dev.yml")
    fi
  fi
  if [[ -f "$ENV_FILE" ]]; then
    COMPOSE_ENV=(--env-file "$ENV_FILE")
  else
    COMPOSE_ENV=()
  fi
}

# Populate COMPOSE_BASE for docker compose invocations
get_compose_base() {
  local mode="${1:-run}"
  local ssl="${2:-default}"

  ensure_service_ids
  ensure_compose_cmd
  compose_args "$mode" "$ssl"
  COMPOSE_BASE=("${COMPOSE_BIN[@]}")
  if ((${#COMPOSE_ENV[@]})); then
    COMPOSE_BASE+=("${COMPOSE_ENV[@]}")
  fi
  if ((${#COMPOSE_ARGS[@]})); then
    COMPOSE_BASE+=("${COMPOSE_ARGS[@]}")
  fi
}

# Detect which stack is actually running by checking container labels
detect_running_stack() {
  local container
  container=$(docker ps --filter "label=com.docker.compose.project=devpush" --filter "label=com.docker.compose.service=app" --format "{{.ID}}" 2>/dev/null | head -1)
  if [[ -z "$container" ]]; then
    return 1
  fi
  
  local config_files
  config_files=$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null || echo "")
  
  if [[ "$config_files" == *"setup.yml"* ]]; then
    echo "setup"
  elif [[ "$config_files" == *"run.yml"* ]]; then
    echo "run"
  else
    echo "unknown"
  fi
  return 0
}

# Check if any devpush containers are running
is_stack_running() {
  docker ps --filter "label=com.docker.compose.project=devpush" --format "{{.ID}}" 2>/dev/null | grep -q .
}

# Fetch public IP and persist unless --no-save
get_public_ip() {
  local save=1
  if [[ "${1:-}" == "--no-save" ]]; then
    save=0
  fi

  local ip=""

  # Try outbound services first
  local endpoint
  for endpoint in "https://api.ipify.org" "http://checkip.amazonaws.com"; do
    if command -v curl >/dev/null 2>&1; then
      ip="$(curl -fsS --max-time 3 "$endpoint" 2>/dev/null || true)"
    elif command -v wget >/dev/null 2>&1; then
      ip="$(wget -q -T 3 -O - "$endpoint" 2>/dev/null || true)"
    fi
    ip="${ip//$'\r'/}"
    [[ -n "$ip" ]] && break
  done

  # Fallback to local interface detection
  if [[ -z "$ip" ]]; then
    if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
      ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    elif [[ "$(uname -s)" == "Darwin" ]]; then
      ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || printf '')"
    fi
  fi

  if [[ -n "$ip" && $save -eq 1 ]]; then
    json_upsert "$CONFIG_FILE" public_ip "$ip"
  fi

  printf "%s\n" "$ip"
}

# Send telemetry payload to API (or build one from version.json)
send_telemetry() {
  local event="$1"
  local payload="${2:-}"
  local endpoint="https://api.devpu.sh/v1/telemetry"

  if [[ -z "$payload" ]]; then
    [[ -f "$VERSION_FILE" ]] || return 0
    payload=$(jq -c --arg ev "$event" '. + {event: $ev}' "$VERSION_FILE" 2>/dev/null || printf '')
    [[ -n "$payload" ]] || return 0
  fi

  for attempt in 1 2 3; do
    if curl -fsSL -X POST -H 'Content-Type: application/json' -d "$payload" "$endpoint" >/tmp/devpush_telemetry.log 2>&1; then
      printf "Telemetry attempt %s succeeded.\n" "$attempt"
      rm -f /tmp/devpush_telemetry.log
      return 0
    fi
    cat /tmp/devpush_telemetry.log 2>/dev/null || true
    [[ $attempt -lt 3 ]] && sleep 1
  done

  return 1
}
