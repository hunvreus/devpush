#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

DATA_DIR="/var/lib/devpush"
APP_DIR="/opt/devpush"
export DATA_DIR APP_DIR

if [[ -t 1 ]]; then
  RED="$(printf '\033[31m')"; GRN="$(printf '\033[32m')"; YEL="$(printf '\033[33m')"; BLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; NC="$(printf '\033[0m')"
else
  RED=""; GRN=""; YEL=""; BLD=""; DIM=""; NC=""
fi

# Child marker (Unicode when UTF-8 TTY, ASCII otherwise)
is_utf8(){ case "${LC_ALL:-${LANG:-}}" in *UTF-8*|*utf8*) return 0;; *) return 1;; esac; }
CHILD_MARK="-"
if [[ -t 1 ]] && is_utf8; then CHILD_MARK="└─"; fi

err(){ echo -e "${RED}Error:${NC} $*" >&2; }
ok(){ echo -e "${GRN}Success:${NC} $*"; }
info(){ echo "$*"; }

VERBOSE="${VERBOSE:-0}"
CMD_LOG="${TMPDIR:-/tmp}/devpush-cmd.$$.log"
# Default per-script error log
: "${SCRIPT_ERR_LOG:=/tmp/$(basename "$0" .sh)_error.log}"

# Spinner: draws a clean in-place indicator; hides cursor while running
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

# Build compose args/env arrays (stack or setup)
compose_args() {
  local mode="${1:-stack}"
  local ssl="${2:-default}"
  if [[ "$mode" == "setup" ]]; then
    COMPOSE_ARGS=(-p devpush -f "$APP_DIR/compose/setup.yml")
    COMPOSE_ENV=()
  else
    COMPOSE_ARGS=(-p devpush -f "$APP_DIR/compose/base.yml" -f "$APP_DIR/compose/override.yml" -f "$APP_DIR/compose/ssl-${ssl}.yml")
    COMPOSE_ENV=(--env-file "$DATA_DIR/.env")
  fi
}

# Wrapper to execute commands with optional verbosity and spinner
run_cmd() {
    local msg="$1"; shift
    local cmd=("$@")

    if ((VERBOSE == 1)); then
        echo "$msg"
        "${cmd[@]}"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
            err "Failed running: ${cmd[*]}"
            exit $exit_code
        else
            echo "${GRN}Done ✔${NC}"
        fi
    else
        : >"$CMD_LOG"
        "${cmd[@]}" >"$CMD_LOG" 2>&1 &
        local pid=$!
        SPIN_PREFIX="$msg"
        spinner "$pid"
        wait "$pid"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
            # Clear spinner line and print failure on its own line
            printf "\r\033[K"
            echo "$SPIN_PREFIX ${RED}✖${NC}"
            echo ""
            err "Failed. Command output:"
            if [[ -s "$CMD_LOG" ]]; then
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" >&2
                fi
            else
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    echo -e "  ${DIM}(no output captured)${NC}" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    echo -e "  ${DIM}(no output captured)${NC}" >&2
                fi
            fi
            echo ""
            rm -f "$CMD_LOG" 2>/dev/null || true
            exit $exit_code
        else
            printf "\r\033[K"
            echo "$SPIN_PREFIX ${GRN}✔${NC}"
            rm -f "$CMD_LOG" 2>/dev/null || true
        fi
    fi
}

# Non-fatal variant: prints same UI but returns non-zero on failure
run_cmd_try() {
    local msg="$1"; shift
    local cmd=("$@")

    if ((VERBOSE == 1)); then
        echo "$msg"
        "${cmd[@]}"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
            err "Failed running: ${cmd[*]}"
            return $exit_code
        else
            echo "${GRN}Done ✔${NC}"
            return 0
        fi
    else
        : >"$CMD_LOG"
        "${cmd[@]}" >"$CMD_LOG" 2>&1 &
        local pid=$!
        SPIN_PREFIX="$msg"
        spinner "$pid"
        wait "$pid"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
            printf "\r\033[K"
            echo "$SPIN_PREFIX ${RED}✖${NC}"
            echo ""
            err "Failed. Command output:"
            if [[ -s "$CMD_LOG" ]]; then
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    sed "s/^/  ${DIM}/" "$CMD_LOG" | sed "s/$/${NC}/" >&2
                fi
            else
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    echo -e "  ${DIM}(no output captured)${NC}" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    echo -e "  ${DIM}(no output captured)${NC}" >&2
                fi
            fi
            echo ""
            rm -f "$CMD_LOG" 2>/dev/null || true
            return $exit_code
        else
            printf "\r\033[K"
            echo "$SPIN_PREFIX ${GRN}✔${NC}"
            rm -f "$CMD_LOG" 2>/dev/null || true
            return 0
        fi
    fi
}

# Read a key's value from a dotenv file (unquoted)
read_env_value(){
  local env_file="$1"; local key="$2"
  awk -F= -v k="$key" '$1==k{sub(/^[^=]*=/,""); print}' "$env_file" | sed 's/^"\|"$//g' | head -n1
}

# Validate core required env vars exist in the given .env file
validate_core_env(){
  local env_file="$1"
  [[ -f "$env_file" ]] || { err "Not found: $env_file"; exit 1; }
  local req=(
    LE_EMAIL APP_HOSTNAME DEPLOY_DOMAIN EMAIL_SENDER_ADDRESS RESEND_API_KEY
    GITHUB_APP_ID GITHUB_APP_NAME GITHUB_APP_PRIVATE_KEY GITHUB_APP_WEBHOOK_SECRET
    GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET
    SECRET_KEY ENCRYPTION_KEY POSTGRES_PASSWORD SERVER_IP
  )
  local missing=() k v
  for k in "${req[@]}"; do
    v="$(read_env_value "$env_file" "$k")"
    [[ -n "$v" ]] || missing+=("$k")
  done
  if ((${#missing[@]})); then
    # Join missing keys with comma+space regardless of IFS
    local joined
    joined="$(printf "%s, " "${missing[@]}")"
    joined="${joined%, }"
    err "Missing values in $env_file: $joined"
    exit 1
  fi
}

# Determine SSL provider (env > config > default)
get_ssl_provider() {
  local p=""
  if [[ -n "${SSL_PROVIDER:-}" ]]; then
    p="$SSL_PROVIDER"
  elif [[ -f $DATA_DIR/config.json ]]; then
    p="$(jq -r '.ssl_provider // empty' $DATA_DIR/config.json 2>/dev/null || true)"
  fi
  [[ -n "${p:-}" ]] || p="default"
  echo "$p"
}

# Persist chosen provider to config.json
persist_ssl_provider() {
  local provider="$1"
  install -d -m 0755 $DATA_DIR >/dev/null 2>&1 || true
  if test -f $DATA_DIR/config.json; then
    jq --arg p "$provider" '. + {ssl_provider: $p}' $DATA_DIR/config.json | tee $DATA_DIR/config.json.tmp >/dev/null
    mv $DATA_DIR/config.json.tmp $DATA_DIR/config.json
  else
    printf '{"ssl_provider":"%s"}\n' "$provider" | tee $DATA_DIR/config.json >/dev/null
  fi
  chmod 0644 $DATA_DIR/config.json >/dev/null 2>&1 || true
}

# Ensure acme.json exists with correct perms
ensure_acme_json() {
  install -d -m 0755 "$DATA_DIR/traefik" >/dev/null 2>&1 || true
  touch "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
  chmod 600 "$DATA_DIR/traefik/acme.json" >/dev/null 2>&1 || true
}

# Validate provider-specific env vars; optionally read from .env file if provided
validate_ssl_env() {
  local provider="$1"; local env_file="${2:-}"
  case "$provider" in
    default) return 0 ;;
    cloudflare)
      if [[ -n "$env_file" && -f "$env_file" ]]; then
        [[ -n "$(read_env_value "$env_file" CF_DNS_API_TOKEN)" ]] || { err "CF_DNS_API_TOKEN is required for cloudflare DNS-01"; exit 1; }
      else
        : "${CF_DNS_API_TOKEN:?CF_DNS_API_TOKEN is required for cloudflare DNS-01}"
      fi
      ;;
    route53)
      if [[ -n "$env_file" && -f "$env_file" ]]; then
        for k in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION; do [[ -n "$(read_env_value "$env_file" "$k")" ]] || { err "$k required"; exit 1; }; done
      else
        : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}" "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}" "${AWS_REGION:?AWS_REGION required}"
      fi
      ;;
    gcloud)
      if [[ -n "$env_file" && -f "$env_file" ]]; then
        [[ -n "$(read_env_value "$env_file" GCE_PROJECT)" ]] || { err "GCE_PROJECT required"; exit 1; }
      else
        : "${GCE_PROJECT:?GCE_PROJECT required}"
      fi
      [[ -f $DATA_DIR/gcloud-sa.json ]] || { err "$DATA_DIR/gcloud-sa.json missing"; exit 1; }
      ;;
    digitalocean)
      if [[ -n "$env_file" && -f "$env_file" ]]; then
        [[ -n "$(read_env_value "$env_file" DO_AUTH_TOKEN)" ]] || { err "DO_AUTH_TOKEN required"; exit 1; }
      else
        : "${DO_AUTH_TOKEN:?DO_AUTH_TOKEN required}"
      fi
      ;;
    azure)
      if [[ -n "$env_file" && -f "$env_file" ]]; then
        for k in AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID AZURE_RESOURCE_GROUP; do [[ -n "$(read_env_value "$env_file" "$k")" ]] || { err "$k required"; exit 1; }; done
      else
        : "${AZURE_CLIENT_ID:?AZURE_CLIENT_ID required}" "${AZURE_CLIENT_SECRET:?AZURE_CLIENT_SECRET required}" "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID required}" "${AZURE_TENANT_ID:?AZURE_TENANT_ID required}" "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP required}"
      fi
      ;;
    *) err "Unknown SSL provider: $provider"; exit 1 ;;
  esac
}

# Get public IP address from external services or local interface
# Usage: get_public_ip [--no-save]
# Tries multiple external services (api.ipify.org, icanhazip.com, checkip.amazonaws.com, ifconfig.me)
# Falls back to local interface IP if it's public (filters out private ranges)
# Returns IP address or empty string on failure
# Automatically saves to config.json unless --no-save is provided
get_public_ip() {
    local save=1
    if [[ "${1:-}" == "--no-save" ]]; then
        save=0
    fi
    
    local ip
    ip=$(curl -fsS https://api.ipify.org 2>/dev/null || \
         curl -fsS https://icanhazip.com 2>/dev/null || \
         curl -fsS http://checkip.amazonaws.com 2>/dev/null || \
         curl -fsS https://ifconfig.me/ip 2>/dev/null || \
         echo "")
    
    if [[ -z "$ip" ]]; then
        local local_ip
        local_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
        if [[ -n "$local_ip" ]] && [[ ! "$local_ip" =~ ^10\. ]] && \
           [[ ! "$local_ip" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. ]] && \
           [[ ! "$local_ip" =~ ^192\.168\. ]] && \
           [[ ! "$local_ip" =~ ^127\. ]] && \
           [[ ! "$local_ip" =~ ^169\.254\. ]]; then
            ip="$local_ip"
        fi
    fi
    
    if [[ -n "$ip" && $save -eq 1 ]]; then
        install -d -m 0755 $DATA_DIR >/dev/null 2>&1 || true
        if test -f $DATA_DIR/config.json; then
            jq --arg ip "$ip" '. + {public_ip: $ip}' $DATA_DIR/config.json | tee $DATA_DIR/config.json.tmp >/dev/null
            mv $DATA_DIR/config.json.tmp $DATA_DIR/config.json
        else
            printf '{"public_ip":"%s"}\n' "$ip" | tee $DATA_DIR/config.json >/dev/null
        fi
        chmod 0644 $DATA_DIR/config.json >/dev/null 2>&1 || true
    fi
    
    echo "$ip"
}

# Send telemetry
# Usage: send_telemetry <event_type> [payload]
# If payload is provided, uses it directly; otherwise reads from version.json
# Returns 0 on success, 1 on failure
send_telemetry() {
    local event="$1"
    local payload="${2:-}"
    local response
    
    # If no payload provided, read from version.json
    if [[ -z "$payload" ]]; then
        [[ -f $DATA_DIR/version.json ]] || return 0
        payload=$(jq -c --arg ev "$event" '. + {event: $ev}' $DATA_DIR/version.json 2>/dev/null || echo "")
        [[ -n "$payload" ]] || return 0
    fi
    
    for attempt in 1 2 3; do
        response=$(curl -fsSL -X POST -H 'Content-Type: application/json' -d "$payload" https://api.devpu.sh/v1/telemetry 2>&1 || true)
        if [[ -n "$response" ]]; then
                return 0
        fi
        [[ $attempt -lt 3 ]] && sleep 1
    done
    
    return 1
}
