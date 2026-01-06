#!/usr/bin/env bash
set -Eeuo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$LIB_DIR/.." && pwd)"

# Colors and formatting
if [[ -t 1 ]]; then
  RED="$(printf '\033[31m')"
  GRN="$(printf '\033[32m')"
  YEL="$(printf '\033[33m')"
  BLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  NC="$(printf '\033[0m')"
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

# Detect environment (production or development)
ENVIRONMENT="${DEVPUSH_ENV:-}"
if [[ -z "$ENVIRONMENT" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    ENVIRONMENT="development"
  else
    ENVIRONMENT="production"
  fi
fi

# Application, data, log, and backup paths
if [[ "$ENVIRONMENT" == "production" ]]; then
  APP_DIR="${DEVPUSH_APP_DIR:-/opt/devpush}"
  DATA_DIR="${DEVPUSH_DATA_DIR:-/var/lib/devpush}"
  LOG_DIR="${DEVPUSH_LOG_DIR:-/var/log/devpush}"
  BACKUP_DIR="${DEVPUSH_BACKUP_DIR:-/var/backups/devpush}"
else
  APP_DIR="${DEVPUSH_APP_DIR:-$PROJECT_ROOT}"
  DATA_DIR="${DEVPUSH_DATA_DIR:-$APP_DIR/data}"
  LOG_DIR="${DEVPUSH_LOG_DIR:-$APP_DIR/logs}"
  BACKUP_DIR="${DEVPUSH_BACKUP_DIR:-$APP_DIR/backups}"
fi

# Environment file, config file, version file
ENV_FILE="$DATA_DIR/.env"
CONFIG_FILE="$DATA_DIR/config.json"
VERSION_FILE="$DATA_DIR/version.json"

export ENVIRONMENT APP_DIR DATA_DIR ENV_FILE CONFIG_FILE VERSION_FILE LOG_DIR BACKUP_DIR

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

# Run command with optional --try flag to return instead of exiting on failure
run_cmd() {
  local no_exit=0
  if [[ "${1:-}" == "--try" ]]; then
    no_exit=1
    shift
  fi
  local msg="$1"; shift
  local cmd=("$@")

  if ((VERBOSE == 1)); then
    printf "%s\n" "$msg"
    "${cmd[@]}"
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
      err "Failed running: ${cmd[*]}"
      if (( no_exit == 1 )); then
        return $exit_code
      else
        exit $exit_code
      fi
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
      if (( no_exit == 1 )); then
        return $exit_code
      else
        exit $exit_code
      fi
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
  awk -v k="$key" '
    /^[[:space:]]*#/ {next}
    {
      match($0, /^[[:space:]]*([^=[:space:]]+)[[:space:]]*=/)
      if (RSTART > 0) {
        key_part = substr($0, RSTART, RLENGTH)
        gsub(/^[[:space:]]+|[[:space:]]+$|[[:space:]]*=$/, "", key_part)
        if (key_part == k) {
          val = substr($0, RSTART + RLENGTH)
          sub(/^[[:space:]]+/, "", val)
          if (val ~ /^"/) {
            val = substr(val, 2)
            sub(/"$/, "", val)
          } else if (val ~ /^'\''/) {
            val = substr(val, 2)
            sub(/'\''$/, "", val)
          } else {
            sub(/[[:space:]]*#.*$/, "", val)
          }
          sub(/[[:space:]]+$/, "", val)
          print val
          exit
        }
      }
    }
  ' "$env_file"
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

  local exists=0
  if [[ -f "$file" ]]; then
    exists=1
  else
    local dir
    dir="$(dirname "$file")"
    if [[ ! -d "$dir" ]]; then
      mkdir -p -m 0750 "$dir" || {
        err "json_upsert: failed to create directory: $dir"
        return 1
      }
    fi
  fi

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

  local output
  if (( exists )); then
    output="$(jq -c "${jq_args[@]}" "$filter" "$file")" || {
      err "json_upsert: failed to update $file"
      return 1
    }
  else
    output="$(jq -c -n "${jq_args[@]}" "$filter")" || {
      err "json_upsert: failed to build JSON for $file"
      return 1
    }
  fi

  printf '%s' "$output" > "$file" || {
    err "json_upsert: failed writing to $file"
    return 1
  }
}

# Error trap used by init_script_logging
_script_err_trap() {
  local s=$?
  local name="${CURRENT_SCRIPT_NAME:-script}"
  err "${name} failed (exit $s)"
  printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"
  printf "%b\n" "${RED}Error output:${NC}"
  if [[ -n "${SCRIPT_ERR_LOG:-}" && -f "$SCRIPT_ERR_LOG" ]]; then
    cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"
  else
    printf "No error details captured\n"
  fi
  if declare -f on_error_hook >/dev/null 2>&1; then
    on_error_hook "$s"
  fi
  exit $s
}

# Initialize script logging
init_script_logging() {
  local name="${1:-$(basename "$0" .sh)}"
  local log_dir="${LOG_DIR:-/var/log/devpush}"
  CURRENT_SCRIPT_NAME="$name"

  install -d -m 0750 "$log_dir" >/dev/null 2>&1 || true
  SCRIPT_ERR_LOG="$log_dir/${name}-error.log"
  ln -sfn "$SCRIPT_ERR_LOG" "$log_dir/${name}_error.log" >/dev/null 2>&1 || true
  exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)
  trap '_script_err_trap' ERR
}

# Build runner images (data-dir override or core images.json)
build_runner_images() {
  local no_cache=0
  local target=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-cache) no_cache=1; shift ;;
      --image) target="$2"; shift 2 ;;
      --image=*) target="${1#*=}"; shift ;;
      *) err "Unknown option: $1"; return 1 ;;
    esac
  done

  local core_runner_dir="$APP_DIR/docker/runner"
  local override_runner_dir="$DATA_DIR/runner"
  local core_images_json="$APP_DIR/app/settings/images.json"
  local override_images_json="$DATA_DIR/images.json"
  local settings_json="$core_images_json"
  local entries=()

  if [[ -f "$override_images_json" ]]; then
    settings_json="$override_images_json"
  fi

  if [[ -f "$settings_json" && -n "${settings_json:-}" ]]; then
    runner_list_cmd=(jq -r '.[] | select(type=="object") | select(.slug and (.slug|type=="string")) | "\(.slug)|\(.name // .slug)"' "$settings_json")
    if command -v mapfile >/dev/null 2>&1; then
      mapfile -t entries < <("${runner_list_cmd[@]}" 2>/dev/null || true)
    else
      while IFS= read -r line; do
        entries+=("$line")
      done < <("${runner_list_cmd[@]}" 2>/dev/null || true)
    fi
  fi

  if ((${#entries[@]} == 0)); then
    printf "  ${DIM}${CHILD_MARK} Skipping (no runner definitions found)${NC}\n"
    return 0
  fi

  local built=0
  local failed=0
  for entry in "${entries[@]}"; do
    IFS='|' read -r slug name <<<"$entry"
    [[ -n "$slug" ]] || continue
    if [[ -n "$target" && "$slug" != "$target" ]]; then
      continue
    fi

    local dockerfile="$override_runner_dir/Dockerfile.$slug"
    local dockerfile_dir="$override_runner_dir"
    if [[ ! -f "$dockerfile" ]]; then
      dockerfile="$core_runner_dir/Dockerfile.$slug"
      dockerfile_dir="$core_runner_dir"
    fi
    local label="${name}"
    
    if [[ ! -f "$dockerfile" ]]; then
      printf "${CHILD_MARK} ${label} ${YEL}⊘${NC}\n"
      local display_path="${dockerfile#$APP_DIR/}"
      [[ "$display_path" == "$dockerfile" ]] && display_path="${dockerfile#$DATA_DIR/}"
      printf "  ${DIM}${CHILD_MARK} Skipping (missing %s)${NC}\n" "$display_path"
      continue
    fi

    built=1
    local build_cmd=(docker build -f "$dockerfile" -t "runner-$slug")
    ((no_cache==1)) && build_cmd+=(--no-cache)
    build_cmd+=("$dockerfile_dir")
    if ! run_cmd --try "${CHILD_MARK} ${label}" "${build_cmd[@]}"; then
      ((failed+=1))
    fi
  done

  if ((built==0)); then
    if [[ -n "$target" ]]; then
      printf "  ${DIM}${CHILD_MARK} 'Dockerfile.%s' not found${NC}\n" "$target"
    else
      printf "  ${DIM}${CHILD_MARK} No runners matched criteria${NC}\n"
    fi
  elif ((failed>0)); then
    printf "  ${DIM}${CHILD_MARK} %s runner build(s) failed${NC}\n" "$failed"
  fi
}

# Validate environment variables
validate_env(){
  local env_file="$1"

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

  # Certificate challenge provider-specific environment variables
  if [[ "$ENVIRONMENT" == "production" ]]; then
    local email="${LE_EMAIL:-$(read_env_value "$env_file" LE_EMAIL)}"
    [[ -n "$email" ]] || missing+=("LE_EMAIL")

    local provider
    provider="$(get_cert_challenge_provider "$env_file")"

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
        err "Unknown certificate challenge provider: $provider"
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

# Validation constants
VALID_CERT_CHALLENGE_PROVIDERS="default|cloudflare|route53|gcloud|digitalocean|azure"
VALID_COMPONENTS="app|worker-arq|worker-monitor|alloy|traefik|loki|redis|docker-proxy|pgsql"

# Resolve certificate challenge provider from env
get_cert_challenge_provider() {
  local env_file="${1:-$ENV_FILE}"
  local provider="${CERT_CHALLENGE_PROVIDER:-}"

  if [[ -z "$provider" ]]; then
    provider="$(read_env_value "$env_file" CERT_CHALLENGE_PROVIDER)"
  fi

  provider="${provider:-default}"
  if [[ ! "$provider" =~ ^(${VALID_CERT_CHALLENGE_PROVIDERS//|/|})$ ]]; then
    err "Invalid certificate challenge provider: $provider (must be one of: $VALID_CERT_CHALLENGE_PROVIDERS)"
    exit 1
  fi

  printf "%s\n" "$provider"
}

# Validate component
validate_component() {
  local comp="$1"
  if [[ ! "$comp" =~ ^(${VALID_COMPONENTS//|/|})$ ]]; then
    err "Invalid component: $comp (must be one of: $VALID_COMPONENTS)"
    return 1
  fi
  return 0
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
set_service_ids() {
  local env_uid env_gid
  env_uid="$(read_env_value "$ENV_FILE" SERVICE_UID)"
  env_gid="$(read_env_value "$ENV_FILE" SERVICE_GID)"

  local candidate="${SERVICE_USER:-${DEVPUSH_SERVICE_USER:-}}"
  if [[ -z "$candidate" ]]; then
    candidate="$(default_service_user)"
  fi

  local uid="" gid=""
  if [[ -n "$env_uid" && -n "$env_gid" ]]; then
    uid="$env_uid"
    gid="$env_gid"
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

# Ensure traefik/acme.json exists with proper perms
ensure_acme_json() {
  install -d -m 0755 "$DATA_DIR/traefik" >/dev/null 2>&1 || true
  touch "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
  chmod 600 "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
  if [[ "$ENVIRONMENT" == "production" ]]; then
    service_user="$(default_service_user)"
    chown "$service_user:$service_user" "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
  fi
}

# Docker compose variables
COMPOSE_BIN=()
COMPOSE_ARGS=()
COMPOSE_ENV=()
COMPOSE_BASE=()

# Detect compose command (`docker compose` preferred)
set_compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
    return 0
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
    return 0
  fi
  return 1
}

# Populate COMPOSE_BASE for docker compose invocations
set_compose_base() {
  set_service_ids
  if ((${#COMPOSE_BIN[@]} == 0)); then
    if ! set_compose_cmd; then
      err "Neither 'docker compose' nor 'docker-compose' is available. Install Docker v20.10+ or docker-compose."
      exit 1
    fi
  fi

  local ssl="$(get_cert_challenge_provider)"
  COMPOSE_ARGS=(-p devpush -f "$APP_DIR/compose/base.yml")
  if [[ "$ENVIRONMENT" == "production" ]]; then
    COMPOSE_ARGS+=(-f "$APP_DIR/compose/override.yml")
    COMPOSE_ARGS+=(-f "$APP_DIR/compose/ssl-${ssl}.yml")
  else
    COMPOSE_ARGS+=(-f "$APP_DIR/compose/override.dev.yml")
  fi

  COMPOSE_BASE=("${COMPOSE_BIN[@]}")
  if [[ -f "$ENV_FILE" ]]; then
    COMPOSE_BASE+=(--env-file "$ENV_FILE")
  fi
  COMPOSE_BASE+=("${COMPOSE_ARGS[@]}")
}


# Check if any devpush containers are running
is_stack_running() {
  docker ps --filter "label=com.docker.compose.project=devpush" --format "{{.ID}}" 2>/dev/null | grep -q .
}

# Fetch public IP and persist unless --no-save
get_public_ip() {
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
