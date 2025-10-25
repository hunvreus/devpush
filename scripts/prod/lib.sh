#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

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
    local prefix="$2"
    local delay=0.1
    local frames='-|\/'
    local i=0
    { tput civis 2>/dev/null || printf "\033[?25l"; } 2>/dev/null
    while kill -0 "$pid" 2>/dev/null; do
        i=$(((i + 1) % 4))
        printf "\r%s [%c]\033[K" "$prefix" "${frames:$i:1}" >&2
        sleep "$delay"
    done
    { tput cnorm 2>/dev/null || printf "\033[?25h"; } 2>/dev/null
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
        spinner "$pid" "$msg"
        wait "$pid"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
            # Clear spinner line and print failure on its own line
            printf "\r\033[K"
            echo "$msg ${RED}✖${NC}"
            echo ""
            err "Failed. Command output:"
            if [[ -s "$CMD_LOG" ]]; then
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    sed 's/^/  /' "$CMD_LOG" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    sed 's/^/  /' "$CMD_LOG" >&2
                fi
            else
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    echo "  (no output captured)" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    echo "  (no output captured)" >&2
                fi
            fi
            echo ""
            rm -f "$CMD_LOG" 2>/dev/null || true
            exit $exit_code
        else
            printf "\r\033[K"
            echo "$msg ${GRN}✔${NC}"
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
        spinner "$pid" "$msg"
        wait "$pid"
        local exit_code=$?
        if [[ $exit_code -ne 0 ]]; then
            printf "\r\033[K"
            echo "$msg ${RED}✖${NC}"
            echo ""
            err "Failed. Command output:"
            if [[ -s "$CMD_LOG" ]]; then
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    sed 's/^/  /' "$CMD_LOG" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    sed 's/^/  /' "$CMD_LOG" >&2
                fi
            else
                if [[ -n "${SCRIPT_ERR_LOG:-}" ]]; then
                    echo "  (no output captured)" | tee -a "$SCRIPT_ERR_LOG" >&2
                else
                    echo "  (no output captured)" >&2
                fi
            fi
            echo ""
            rm -f "$CMD_LOG" 2>/dev/null || true
            return $exit_code
        else
            printf "\r\033[K"
            echo "$msg ${GRN}✔${NC}"
            rm -f "$CMD_LOG" 2>/dev/null || true
            return 0
        fi
    fi
}

# Read a key's value from a dotenv file (unquoted)
read_env_value(){
  local envf="$1"; local key="$2"
  awk -F= -v k="$key" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g' | head -n1
}

# Validate core required env vars exist in the given .env file
validate_core_env(){
  local envf="$1"
  [[ -f "$envf" ]] || { err "Not found: $envf"; exit 1; }
  local req=(
    LE_EMAIL APP_HOSTNAME DEPLOY_DOMAIN EMAIL_SENDER_ADDRESS RESEND_API_KEY
    GITHUB_APP_ID GITHUB_APP_NAME GITHUB_APP_PRIVATE_KEY GITHUB_APP_WEBHOOK_SECRET
    GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET
    SECRET_KEY ENCRYPTION_KEY POSTGRES_PASSWORD SERVER_IP
  )
  local missing=() k v
  for k in "${req[@]}"; do
    v="$(read_env_value "$envf" "$k")"
    [[ -n "$v" ]] || missing+=("$k")
  done
  if ((${#missing[@]})); then
    # Join missing keys with comma+space regardless of IFS
    local joined
    joined="$(printf "%s, " "${missing[@]}")"
    joined="${joined%, }"
    err "Missing values in $envf: $joined"
    exit 1
  fi
}

# Determine SSL provider (env > config > default)
get_ssl_provider() {
  local p=""
  if [[ -n "${SSL_PROVIDER:-}" ]]; then
    p="$SSL_PROVIDER"
  elif [[ -f /var/lib/devpush/config.json ]]; then
    p="$(jq -r '.ssl_provider // empty' /var/lib/devpush/config.json 2>/dev/null || true)"
  fi
  [[ -n "${p:-}" ]] || p="default"
  echo "$p"
}

# Persist chosen provider to config.json
persist_ssl_provider() {
  local provider="$1"
  sudo install -d -m 0755 /var/lib/devpush >/dev/null 2>&1 || true
  printf '{"ssl_provider":"%s"}\n' "$provider" | sudo tee /var/lib/devpush/config.json >/dev/null
  sudo chmod 0644 /var/lib/devpush/config.json >/dev/null 2>&1 || true
}

# Ensure acme.json exists with correct perms
ensure_acme_json() {
  sudo install -d -m 0755 /srv/devpush/traefik >/dev/null 2>&1 || true
  sudo touch /srv/devpush/traefik/acme.json >/dev/null 2>&1 || true
  sudo chmod 600 /srv/devpush/traefik/acme.json >/dev/null 2>&1 || true
}

# Validate provider-specific env vars; optionally read from .env file if provided
validate_ssl_env() {
  local provider="$1"; local envf="${2:-}"
  case "$provider" in
    default) return 0 ;;
    cloudflare)
      if [[ -n "$envf" && -f "$envf" ]]; then
        [[ -n "$(read_env_value "$envf" CF_DNS_API_TOKEN)" ]] || { err "CF_DNS_API_TOKEN is required for cloudflare DNS-01"; exit 1; }
      else
        : "${CF_DNS_API_TOKEN:?CF_DNS_API_TOKEN is required for cloudflare DNS-01}"
      fi
      ;;
    route53)
      if [[ -n "$envf" && -f "$envf" ]]; then
        for k in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION; do [[ -n "$(read_env_value "$envf" "$k")" ]] || { err "$k required"; exit 1; }; done
      else
        : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}" "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}" "${AWS_REGION:?AWS_REGION required}"
      fi
      ;;
    gcloud)
      if [[ -n "$envf" && -f "$envf" ]]; then
        [[ -n "$(read_env_value "$envf" GCE_PROJECT)" ]] || { err "GCE_PROJECT required"; exit 1; }
      else
        : "${GCE_PROJECT:?GCE_PROJECT required}"
      fi
      [[ -f /srv/devpush/gcloud-sa.json ]] || { err "/srv/devpush/gcloud-sa.json missing"; exit 1; }
      ;;
    digitalocean)
      if [[ -n "$envf" && -f "$envf" ]]; then
        [[ -n "$(read_env_value "$envf" DO_AUTH_TOKEN)" ]] || { err "DO_AUTH_TOKEN required"; exit 1; }
      else
        : "${DO_AUTH_TOKEN:?DO_AUTH_TOKEN required}"
      fi
      ;;
    azure)
      if [[ -n "$envf" && -f "$envf" ]]; then
        for k in AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID AZURE_RESOURCE_GROUP; do [[ -n "$(read_env_value "$envf" "$k")" ]] || { err "$k required"; exit 1; }; done
      else
        : "${AZURE_CLIENT_ID:?AZURE_CLIENT_ID required}" "${AZURE_CLIENT_SECRET:?AZURE_CLIENT_SECRET required}" "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID required}" "${AZURE_TENANT_ID:?AZURE_TENANT_ID required}" "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP required}"
      fi
      ;;
    *) err "Unknown SSL provider: $provider"; exit 1 ;;
  esac
}