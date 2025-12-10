#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

[[ $EUID -eq 0 ]] || { printf "This script must be run as root (sudo).\n" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "update-apply"

usage(){
  cat <<USG
Usage: update-apply.sh [--ref <tag>] [--all | --components <csv> | --full] [--no-migrate] [--no-telemetry] [--yes|-y] [--verbose]

Apply a fetched update: validate, pull images, rollout, migrate, and record version.

  --ref <tag>       Git tag to record (best-effort if omitted)
  --all             Update app,worker-arq,worker-monitor,alloy
  --components <csv>
                    Comma-separated list of services to update (${VALID_COMPONENTS//|/, })
  --full            Full stack update (down whole stack, then up). Causes downtime
  --no-migrate      Do not run DB migrations after app update
  --no-telemetry    Do not send telemetry
  --yes, -y         Non-interactive yes to prompts
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

# Parse CLI flags
ref=""; comps=""; do_all=0; do_full=0; migrate=1; yes=0; skip_components=0; telemetry=1
[[ "${NO_TELEMETRY:-0}" == "1" ]] && telemetry=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --all) do_all=1; shift ;;
    --components)
      comps="$2"
      IFS=',' read -ra _ua_secs <<< "$comps"
      for comp in "${_ua_secs[@]}"; do
        comp="${comp// /}"
        [[ -z "$comp" ]] && continue
        if ! validate_component "$comp"; then
          exit 1
        fi
      done
      shift 2
      ;;
    --full) do_full=1; shift ;;
    --no-migrate) migrate=0; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    --yes|-y) yes=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if ((do_full==1)) && { ((do_all==1)) || [[ -n "$comps" ]]; }; then
  err "--full cannot be combined with --all or --components"
  exit 1
fi

if [[ "$ENVIRONMENT" == "development" ]]; then
  err "This script is for production only. For development, simply pull code with git. More information: https://devpu.sh/docs/installation/#development"
  exit 1
fi

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

# Ensure version.json exists
if [[ ! -f "$VERSION_FILE" ]]; then
  err "version.json not found. Run install.sh first."
  exit 1
fi

# Determine service user/group
set_service_ids

# Validate environment variables
validate_env "$ENV_FILE"

# Ensure acme.json exists with strict perms (in case update runs standalone)
ensure_acme_json

# Build compose arguments
set_compose_base

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
  local hooks_dir="${3:-$PWD/scripts/upgrades}"

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

  printf '\n'
  printf "Running %s upgrade(s)...\n" "$count"

  # Execute hooks
  for script in "${eligible[@]}"; do
    local hook_name
    hook_name=$(basename "$script")
    if ! run_cmd --try "${CHILD_MARK} Running $hook_name..." bash "$script"; then
      printf "${YEL}Upgrade %s failed (continuing update).${NC}\n" "$hook_name"
    fi
  done
}

old_version=$(json_get git_ref "$VERSION_FILE" "")
if [[ -z "$old_version" ]]; then
  printf '\n'
  printf "${YEL}No version found in %s. Skipping upgrade hooks.${NC}\n" "$DATA_DIR/version.json"
elif [[ -z "$ref" ]]; then
  printf '\n'
  printf "${YEL}No target version specified. Skipping upgrade hooks.${NC}\n"
else
  run_upgrade_hooks "$old_version" "$ref" "$APP_DIR/scripts/upgrades"
fi

# Full stack update helper (with downtime)
full_update() {
  printf '\n'
  printf "Full stack update...\n"
  run_cmd "${CHILD_MARK} Building..." "${COMPOSE_BASE[@]}" build
  run_cmd "${CHILD_MARK} Stopping stack..." "${COMPOSE_BASE[@]}" down --remove-orphans
  run_cmd "${CHILD_MARK} Starting stack..." "${COMPOSE_BASE[@]}" up -d --force-recreate --remove-orphans
  skip_components=1
  if ((migrate==1)); then
    printf '\n'
    printf "Applying migrations...\n"
    run_cmd "${CHILD_MARK} Running database migrations..." bash "$SCRIPT_DIR/db-migrate.sh"
  fi
}

# Do not pull all images up-front; build/pull per-service below

# Option1: Full update (with downtime)
if ((do_full==1)); then
  if ((yes!=1)); then
    printf "${YEL}This will stop ALL services, update, and restart the whole stack. Downtime WILL occur.${NC}\n"
    read -p "Proceed? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]([Ee][Ss])?$ ]] || { info "Aborted."; exit 1; }
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
  printf '\n'
  printf "Select components to update:\n"
  printf "1) app + workers + alloy (app, worker-arq, worker-monitor, alloy)\n"
  printf "2) app\n"
  printf "3) worker-arq\n"
  printf "4) worker-monitor\n"
  printf "5) Full stack (with downtime)\n"
  read -r -p "Choice [1-5]: " ch
  ch="${ch//[^0-9]/}"
  case "$ch" in
    1) comps="app,worker-arq,worker-monitor,alloy" ;;
    2) comps="app" ;;
    3) comps="worker-arq" ;;
    4) comps="worker-monitor" ;;
    5)
      printf '\n'
      printf "${YEL}This will stop ALL services, update, and restart the whole stack. Downtime WILL occur.${NC}\n"
      read -r -p "Proceed with FULL stack update? [y/N]: " ans
      [[ "$ans" =~ ^[Yy]([Ee][Ss])?$ ]] || { info "Aborted."; exit 1; }
      full_update
      ;;
    *)
      printf "Invalid choice.\n"
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
  local cur_cnt
  cur_cnt=$(printf '%s\n' "$old_ids" | wc -w)
  local target=$((cur_cnt+1)); [[ $target -lt 1 ]] && target=1
  
  run_cmd "${CHILD_MARK} Scaling up to $target container(s)..." "${COMPOSE_BASE[@]}" up -d --scale "$service=$target" --no-recreate

  local new_id=""
  run_cmd "${CHILD_MARK} Detecting new container..." bash -c '
    old_ids="'"$old_ids"'"
    for _ in $(seq 1 60); do
      cur_ids=$(docker ps --filter "name=devpush-'"$service"'" --format "{{.ID}}" | tr " " "\n" | sort)
      nid=$(comm -13 <(printf '%s\n' "$old_ids" | tr " " "\n" | sort) <(printf '%s\n' "$cur_ids"))
      if [[ -n "$nid" ]]; then
        printf "%s\n" "$nid"
        exit 0
      fi
      sleep 2
    done
    exit 1'
  new_id=$(docker ps --filter "name=devpush-$service" --format '{{.ID}}' | tr ' ' '\n' | sort | comm -13 <(printf '%s\n' "$old_ids" | tr ' ' '\n' | sort) -)
  [[ -n "$new_id" ]] || { err "Failed to detect new container for '$service'"; return 1; }
  printf "  ${DIM}${CHILD_MARK} Container ID: %s${NC}\n" "$new_id"

  run_cmd "${CHILD_MARK} Verifying new container health (timeout: ${timeout_s}s)..." bash -c '
    deadline=$(( $(date +%s) + '"$timeout_s"' ))
    while :; do
      if docker inspect '"$new_id"' --format "{{.State.Health}}" >/dev/null 2>&1; then
        st=$(docker inspect '"$new_id"' --format "{{.State.Health.Status}}" 2>/dev/null || printf "starting")
        [[ "$st" == "healthy" ]] && exit 0
      else
        st=$(docker inspect '"$new_id"' --format "{{.State.Status}}" 2>/dev/null || printf "starting")
        [[ "$st" == "running" ]] && exit 0
      fi
      [[ $(date +%s) -ge $deadline ]] && { printf "Timeout. Status: %s\n" "$st" >&2; exit 1; }
      sleep 5
    done'
  
  if [[ -n "$old_ids" ]]; then
    mapfile -t OLD_CONTAINERS <<<"$old_ids"
    run_cmd --try "${CHILD_MARK} Retiring old container(s)..." bash -c '
      set -Eeuo pipefail
      for id in "$@"; do
        [[ -z "$id" ]] && continue
        docker stop "$id" >/dev/null 2>&1 || printf "  Failed to stop container %s\n" "$id" >&2
        docker rm "$id" >/dev/null 2>&1 || printf "  Failed to remove container %s\n" "$id" >&2
      done
    ' retire "${OLD_CONTAINERS[@]}"
    for id in "${OLD_CONTAINERS[@]}"; do
      printf "  ${DIM}${CHILD_MARK} Container ID: %s${NC}\n" "$id"
    done
  fi
}

# Build/pull then rollout per service
rollout_service(){
  local s="$1"; local mode="$2"; local timeout_s="${3:-}"
  printf '\n'
  printf "Updating %s...\n" "$s"
  case "$s" in
    app|worker-arq|worker-monitor)
      run_cmd "${CHILD_MARK} Building image..." "${COMPOSE_BASE[@]}" build "$s"
      ;;
  esac
  if [[ "$mode" == "blue_green" ]]; then
    blue_green_rollout "$s" "$timeout_s"
  else
    run_cmd "${CHILD_MARK} Recreating container..." "${COMPOSE_BASE[@]}" up -d --no-deps --force-recreate "$s"
  fi
}

if ((skip_components==0)); then
  for s in "${C[@]}"; do
    case "$s" in
      app)
        rollout_service app blue_green
        ;;
      worker-arq)
        timeout="$(read_env_value "$ENV_FILE" JOB_COMPLETION_WAIT || true)"; : "${timeout:=300}"
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
  printf '\n'
  printf "Applying migrations...\n"
  run_cmd "${CHILD_MARK} Running database migrations..." bash "$SCRIPT_DIR/db-migrate.sh"
fi

# Build runner images
printf '\n'
printf "Building runner images...\n"
build_runner_images

# Update install metadata (version.json)
commit=$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" rev-parse --verify HEAD)
if [[ -z "$ref" ]]; then
  ref=$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" describe --tags --exact-match 2>/dev/null || true)
  [[ -n "$ref" ]] || ref=$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" describe --tags --abbrev=0 2>/dev/null || true)
  [[ -n "$ref" ]] || ref=$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" rev-parse --short "$commit")
fi
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
install_id=$(json_get install_id "$VERSION_FILE" "")
if [[ -z "$install_id" ]]; then
  install_id=$(cat /proc/sys/kernel/random/uuid)
fi

json_upsert "$VERSION_FILE" install_id "$install_id" git_ref "$ref" git_commit "$commit" updated_at "$ts"

# Send telemetry
if ((telemetry==1)); then
printf '\n'
  if ! run_cmd --try "Sending telemetry..." send_telemetry update; then
    printf "  ${DIM}${CHILD_MARK} Telemetry failed (non-fatal). Continuing update.${NC}\n"
  fi
fi

# Success message
printf '\n'
printf "${GRN}Update complete (%s → %s). ✔${NC}\n" "${old_version:-unknown}" "$ref"
