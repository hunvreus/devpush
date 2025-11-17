#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_ERR_LOG="/tmp/update_apply_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; echo -e "${RED}Update-apply failed (exit $s)${NC}"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage(){
  cat <<USG
Usage: update-apply.sh [--ref <tag>] [--include-prerelease] [--all | --components app,worker-arq,worker-monitor,alloy | --full] [--no-pull] [--no-migrate] [--no-telemetry] [--yes|-y] [--ssl-provider <name>] [--verbose]

Apply a fetched update: validate, pull images, rollout, migrate, and record version.

  --ref TAG         Git tag to record (best-effort if omitted)
  --include-prerelease  No effect here; kept for arg parity
  --all             Update app,worker-arq,worker-monitor,alloy
  --components CSV  Comma-separated list of services to update (e.g. app,loki,alloy)
  --full            Full stack update (down whole stack, then up). Causes downtime
  --no-pull         Skip docker compose pull
  --no-migrate      Do not run DB migrations after app update
  --no-telemetry    Do not send telemetry
  --yes, -y         Non-interactive yes to prompts
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

app_dir="/home/devpush/devpush"; ref=""; comps=""; do_all=0; do_full=0; pull=1; migrate=1; yes=0; skip_components=0; telemetry=1; ssl_provider=""
[[ "${NO_TELEMETRY:-0}" == "1" ]] && telemetry=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --include-prerelease) shift ;;
    --all) do_all=1; shift ;;
    --components) comps="$2"; shift 2 ;;
    --full) do_full=1; shift ;;
    --no-pull) pull=0; shift ;;
    --no-migrate) migrate=0; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    --yes|-y) yes=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

# Persist ssl_provider if passed
if [[ -n "$ssl_provider" ]]; then persist_ssl_provider "$ssl_provider"; fi
ssl_provider="${ssl_provider:-$(get_ssl_provider)}"

# Ensure acme.json exists with strict perms (in case update runs standalone)
ensure_acme_json

# Validate provider env and core environment variables
validate_ssl_env "$ssl_provider" .env
validate_core_env .env

# Version comparison helpers
ver_lt() {
  [[ "$1" == "$2" ]] && return 1
  [[ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -n1)" == "$1" ]]
}

ver_lte() {
  [[ "$1" == "$2" ]] && return 0
  ver_lt "$1" "$2"
}

# Run upgrade hooks for version transitions
run_upgrade_hooks() {
  local current_ver="$1"
  local target_ver="$2"
  local hooks_dir="${3:-$PWD/scripts/prod/upgrades}"

  [[ -d "$hooks_dir" ]] || return 0

  current_ver="${current_ver%%-*}"
  target_ver="${target_ver%%-*}"

  # Collect eligible hooks first
  local eligible=()
  while IFS= read -r script; do
    local hook_ver
    hook_ver=$(basename "$script" .sh)
    [[ "$hook_ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
    if ver_lt "$current_ver" "$hook_ver" && ver_lte "$hook_ver" "$target_ver"; then
      eligible+=("$script")
    fi
  done < <(find "$hooks_dir" -name "*.sh" -type f 2>/dev/null | sort -V)

  local count=${#eligible[@]}
  ((count==0)) && return 0

  printf "\n"
  echo "Running ${count} upgrade(s)..."

  # Execute hooks
  for script in "${eligible[@]}"; do
    local hook_name
    hook_name=$(basename "$script")
    if ! run_cmd_try "${CHILD_MARK} Running $hook_name..." bash "$script"; then
      echo -e "${YEL}Warning:${NC} Upgrade $hook_name failed (continuing update)"
    fi
  done
}

old_version=$(jq -r '.git_ref // empty' /var/lib/devpush/version.json 2>/dev/null || true)
if [[ -z "$old_version" ]]; then
  printf "\n"
  echo -e "${YEL}Warning:${NC} No version found in /var/lib/devpush/version.json. Skipping upgrade hooks."
elif [[ -z "$ref" ]]; then
  printf "\n"
  echo -e "${YEL}Warning:${NC} No target version specified. Skipping upgrade hooks."
else
  run_upgrade_hooks "$old_version" "$ref" "$app_dir/scripts/prod/upgrades"
fi

# Compose files (keep parity with running stack)
args=(-p devpush -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.override.ssl/"$ssl_provider".yml)

# Full stack update helper (with downtime)
full_update() {
  printf "\n"
  echo "Full stack update..."
  if ((pull==1)); then
    run_cmd "${CHILD_MARK} Building with --pull..." docker compose "${args[@]}" build --pull
  else
    run_cmd "${CHILD_MARK} Building..." docker compose "${args[@]}" build
  fi
  run_cmd "${CHILD_MARK} Stopping stack..." docker compose "${args[@]}" down --remove-orphans
  run_cmd "${CHILD_MARK} Starting stack..." docker compose "${args[@]}" up -d --force-recreate --remove-orphans
  skip_components=1
  if ((migrate==1)); then
    printf "\n"
    echo "Applying migrations..."
    run_cmd "${CHILD_MARK} Running database migrations..." scripts/prod/db-migrate.sh --env-file .env
  fi
}

# Do not pull all images up-front; build/pull per-service below

# Option1: Full update (with downtime)
if ((do_full==1)); then
  if ((do_all==1)) || [[ -n "$comps" ]]; then
    err "--full cannot be combined with --all or --components"
    exit 1
  fi
  if ((yes!=1)); then
    echo -e "${YEL}Warning:${NC} This will stop ALL services, update, and restart the whole stack. Downtime WILL occur."
    read -p "Proceed? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { info "Aborted."; exit 1; }
  fi
  full_update
fi

# Option2: Components update (no downtime for app and workers)
if ((do_all==1)); then
  comps="app,worker-arq,worker-monitor,alloy"
elif [[ -z "$comps" ]]; then
  if [[ ! -t 0 ]]; then
    err "Non-interactive mode: specify --all, --components, or --full"
    exit 1
  fi
  printf "\n"
  echo "Select components to update:"
  echo "1) app + workers + alloy (app, worker-arq, worker-monitor, alloy)"
  echo "2) app"
  echo "3) worker-arq"
  echo "4) worker-monitor"
  echo "5) alloy"
  echo "6) Full stack (with downtime)"
  read -r -p "Choice [1-6]: " ch
  ch="${ch//[^0-9]/}"
  case "$ch" in
    1) comps="app,worker-arq,worker-monitor,alloy" ;;
    2) comps="app" ;;
    3) comps="worker-arq" ;;
    4) comps="worker-monitor" ;;
    5) comps="alloy" ;;
    6)
      printf "\n"
      echo -e "${YEL}Warning:${NC} This will stop ALL services, update, and restart the whole stack. Downtime WILL occur."
      read -r -p "Proceed with FULL stack update? [y/N]: " ans
      [[ "$ans" =~ ^[Yy]$ ]] || { info "Aborted."; exit 1; }
      full_update
      ;;
    *)
      echo "Invalid choice."
      exit 1
      ;;
  esac
fi

IFS=',' read -ra C <<< "$comps"

# Blue‑green helper (expects image already built/pulled as needed)
blue_green_rollout() {
  local service="$1"
  local timeout_s="${2:-300}"

  local old_ids
  old_ids=$(docker ps --filter "name=devpush-$service" --format '{{.ID}}' || true)
  local cur_cnt=$(echo "$old_ids" | wc -w)
  local target=$((cur_cnt+1)); [[ $target -lt 1 ]] && target=1
  
  run_cmd "${CHILD_MARK} Scaling up to $target container(s)..." docker compose "${args[@]}" up -d --scale "$service=$target" --no-recreate

  local new_id=""
  run_cmd "${CHILD_MARK} Detecting new container..." bash -c '
    old_ids="'"$old_ids"'"
    for _ in $(seq 1 60); do
      cur_ids=$(docker ps --filter "name=devpush-'"$service"'" --format "{{.ID}}" | tr " " "\n" | sort)
      nid=$(comm -13 <(echo "$old_ids" | tr " " "\n" | sort) <(echo "$cur_ids"))
      if [[ -n "$nid" ]]; then
        echo "$nid"
        exit 0
      fi
      sleep 2
    done
    exit 1'
  new_id=$(docker ps --filter "name=devpush-$service" --format '{{.ID}}' | tr ' ' '\n' | sort | comm -13 <(echo "$old_ids" | tr ' ' '\n' | sort) -)
  [[ -n "$new_id" ]] || { err "Failed to detect new container for '$service'"; return 1; }
  echo -e "  ${DIM}${CHILD_MARK} Container ID: $new_id${NC}"

  run_cmd "${CHILD_MARK} Verifying new container health (timeout: ${timeout_s}s)..." bash -c '
    deadline=$(( $(date +%s) + '"$timeout_s"' ))
    while :; do
      if docker inspect '"$new_id"' --format "{{.State.Health}}" >/dev/null 2>&1; then
        st=$(docker inspect '"$new_id"' --format "{{.State.Health.Status}}" 2>/dev/null || echo starting)
        [[ "$st" == "healthy" ]] && exit 0
      else
        st=$(docker inspect '"$new_id"' --format "{{.State.Status}}" 2>/dev/null || echo starting)
        [[ "$st" == "running" ]] && exit 0
      fi
      [[ $(date +%s) -ge $deadline ]] && { echo "Timeout. Status: $st" >&2; exit 1; }
      sleep 5
    done'
  
  if [[ -n "$old_ids" ]]; then
    run_cmd "${CHILD_MARK} Retiring old container(s)..." bash -c '
      for id in '"$old_ids"'; do
        docker stop "$id" >/dev/null 2>&1 || true
        docker rm "$id" >/dev/null 2>&1 || true
      done'
    for id in $old_ids; do
      echo -e "  ${DIM}${CHILD_MARK} Container ID: $id${NC}"
    done
  fi

  run_cmd "${CHILD_MARK} Scaling to 1..." docker compose "${args[@]}" up -d --scale "$service=1" --no-recreate
}

# Build/pull then rollout per service
rollout_service(){
  local s="$1"; local mode="$2"; local timeout_s="${3:-}"
  printf "\n"
  echo "Updating $s..."
  case "$s" in
    app|worker-arq|worker-monitor)
      if ((pull==1)); then
        run_cmd "${CHILD_MARK} Building image..." docker compose "${args[@]}" build --pull "$s"
      else
        run_cmd "${CHILD_MARK} Building image..." docker compose "${args[@]}" build "$s"
      fi
      ;;
  esac
  if [[ "$mode" == "blue_green" ]]; then
    blue_green_rollout "$s" "$timeout_s"
  else
    run_cmd "${CHILD_MARK} Recreating container..." docker compose "${args[@]}" up -d --no-deps --force-recreate "$s"
  fi
}

if ((skip_components==0)); then
  for s in "${C[@]}"; do
    case "$s" in
      app)
        rollout_service app blue_green
        ;;
      worker-arq)
        timeout="$(read_env_value .env JOB_COMPLETION_WAIT || true)"; : "${timeout:=300}"
        rollout_service worker-arq blue_green "$timeout"
        ;;
      worker-monitor)
        rollout_service worker-monitor recreate
        ;;
      traefik|loki|redis|docker-proxy|pgsql|alloy)
        rollout_service "$s" recreate
        ;;
      *) err "unknown component: $s"; exit 1 ;;
    esac
  done
fi

# Apply database migrations
if ((skip_components==0)) && [[ "$comps" == *"app"* ]] && ((migrate==1)); then
  printf "\n"
  echo "Applying migrations..."
  run_cmd "${CHILD_MARK} Running database migrations..." scripts/prod/db-migrate.sh --env-file .env
fi

# Update install metadata (version.json)
commit=$(git rev-parse --verify HEAD)
if [[ -z "$ref" ]]; then
  ref=$(git describe --tags --exact-match 2>/dev/null || true)
  [[ -n "$ref" ]] || ref=$(git describe --tags --abbrev=0 2>/dev/null || true)
  [[ -n "$ref" ]] || ref=$(git rev-parse --short "$commit")
fi
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[[ -d /var/lib/devpush ]] || sudo install -d -m 0755 /var/lib/devpush || true

# Update version.json (preserve existing metadata, update git_ref/commit/timestamp)
if sudo test -f /var/lib/devpush/version.json; then
  sudo jq --arg ref "$ref" --arg commit "$commit" --arg ts "$ts" \
    '. + {git_ref: $ref, git_commit: $commit, updated_at: $ts}' \
    /var/lib/devpush/version.json | sudo tee /var/lib/devpush/version.json.tmp >/dev/null
  sudo mv /var/lib/devpush/version.json.tmp /var/lib/devpush/version.json
else
  install_id=$(cat /proc/sys/kernel/random/uuid)
  printf '{"install_id":"%s","git_ref":"%s","git_commit":"%s","updated_at":"%s"}\n' "$install_id" "$ref" "$commit" "$ts" | sudo tee /var/lib/devpush/version.json >/dev/null
fi

# Send telemetry and retrieve public IP
public_ip=""
if ((telemetry==1)); then
  printf "\n"
  run_cmd "Sending telemetry..." send_telemetry update
  public_ip=$(jq -r '.public_ip // empty' /var/lib/devpush/config.json 2>/dev/null || true)
fi

printf "\n"
echo -e "${GRN}Update complete (${old_version:-unknown} → ${ref}). ✔${NC}"
if [[ -n "$public_ip" ]]; then
  echo ""
  echo "Your instance is accessible at: http://${public_ip}"
fi
