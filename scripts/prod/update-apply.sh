#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

source "$(dirname "$0")/lib.sh"

trap 's=$?; echo -e "${RED}Update-apply failed (exit $s)${NC}"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; exit $s' ERR

usage(){
  cat <<USG
Usage: update-apply.sh [--app-dir <path>] [--ref <tag>] [--include-prerelease] [--all | --components app,worker-arq,worker-monitor | --full] [--no-pull] [--no-migrate] [--yes|-y] [--ssl-provider <name>]

Apply a fetched update: validate, pull images, rollout, migrate, and record version.

  --app-dir PATH    App directory (default: $PWD)
  --ref TAG         Git tag to record (best-effort if omitted)
  --include-prerelease  No effect here; kept for arg parity
  --all             Update app,worker-arq,worker-monitor
  --components CSV  Comma-separated list of services to update
  --full            Full stack update (down whole stack, then up). Causes downtime
  --no-pull         Skip docker compose pull
  --no-migrate      Do not run DB migrations after app update
  --yes, -y         Non-interactive yes to prompts
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure
  -h, --help        Show this help
USG
  exit 0
}

app_dir="${APP_DIR:-$(pwd)}"; ref=""; comps=""; do_all=0; do_full=0; pull=1; migrate=1; include_pre=0; yes=0; skip_components=0; ssl_provider=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) app_dir="$2"; shift 2 ;;
    --ref) ref="$2"; shift 2 ;;
    --include-prerelease) include_pre=1; shift ;;
    --all) do_all=1; shift ;;
    --components) comps="$2"; shift 2 ;;
    --full) do_full=1; shift ;;
    --no-pull) pull=0; shift ;;
    --no-migrate) migrate=0; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    --yes|-y) yes=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
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

# Compose files (keep parity with running stack)
args=(-p devpush -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.override.ssl/"$ssl_provider".yml)

# Update registry images (infra) up-front if requested
if ((pull==1)); then
  info "Pulling images..."
  docker compose "${args[@]}" pull || true
fi

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
  info "Full stack update: build, then down + up"
  if ((pull==1)); then
    docker compose "${args[@]}" build --pull || true
  else
    docker compose "${args[@]}" build || true
  fi
  docker compose "${args[@]}" down --remove-orphans || true
  docker compose "${args[@]}" up -d --force-recreate --remove-orphans
  ok "Full stack updated"
  skip_components=1
  if ((migrate==1)); then
    info "Running migrations..."
    scripts/prod/db-migrate.sh --app-dir "$app_dir" --env-file .env
  fi
fi

# Option2: Components update (no downtime for app and workers)
if ((do_all==1)); then
  comps="app,worker-arq,worker-monitor"
elif [[ -z "$comps" ]]; then
  echo "Select components to update (infra services not listed here):"
  echo "1) app + workers (app, worker-arq, worker-monitor)"
  echo "2) app"
  echo "3) worker-arq"
  echo "4) worker-monitor"
  echo
  echo "Tip: use --components traefik,redis,... to update infra; use --full for full stack update (downtime)."
  read -r ch
  case "$ch" in
    1) comps="app,worker-arq,worker-monitor" ;;
    2) comps="app" ;;
    3) comps="worker-arq" ;;
    4) comps="worker-monitor" ;;
    *) err "invalid choice"; exit 1 ;;
  esac
fi

IFS=',' read -ra C <<< "$comps"

# Blue‑green helper (expects image already built/pulled as needed)
blue_green_rollout() {
  local service="$1"
  local timeout_s="${2:-300}"
  
  info "Executing blue-green rollout for '$service'..."

  local old_ids
  old_ids=$(docker ps --filter "name=devpush-$service" --format '{{.ID}}' || true)

  local cur_cnt
  cur_cnt=$(echo "$old_ids" | wc -w | tr -d ' ' || echo 0)
  
  local target=$((cur_cnt+1)); [[ $target -lt 1 ]] && target=1
  info "Scaling up to $target container(s)..."
  docker compose "${args[@]}" up -d --scale "$service=$target" --no-recreate

  local new_id=""
  info "Waiting for new container to appear..."
  for _ in $(seq 1 60); do
    local cur_ids
    cur_ids=$(docker ps --filter "name=devpush-$service" --format '{{.ID}}' | tr ' ' '\n' | sort)
    new_id=$(comm -13 <(echo "$old_ids" | tr ' ' '\n' | sort) <(echo "$cur_ids"))
    [[ -n "$new_id" ]] && break
    sleep 2
  done
  [[ -n "$new_id" ]] || { err "Failed to detect new container for '$service'"; return 1; }
  ok "New container detected: $new_id"

  info "Waiting for new container to be healthy (timeout: ${timeout_s}s)..."
  local deadline=$(( $(date +%s) + timeout_s ))
  while :; do
    local st
    if docker inspect "$new_id" --format '{{.State.Health}}' >/dev/null 2>&1; then
      st=$(docker inspect "$new_id" --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
      if [[ "$st" == "healthy" ]]; then
        ok "New container is healthy."
        break
      fi
    else
      st=$(docker inspect "$new_id" --format '{{.State.Status}}' 2>/dev/null || echo "starting")
      if [[ "$st" == "running" ]]; then
        ok "New container is running (no healthcheck)."
        break
      fi
    fi
    if [[ $(date +%s) -ge $deadline ]]; then
      err "New container for '$service' not ready within ${timeout_s}s. Status: $st"
      docker logs "$new_id" || true
      return 1
    fi
    sleep 5
  done
  
  if [[ -n "$old_ids" ]]; then
    info "Retiring old container(s): $old_ids"
    for id in $old_ids; do
      docker stop "$id" || true
      docker rm "$id" || true
    done
  fi

  info "Scaling back to 1 container..."
  docker compose "${args[@]}" up -d --scale "$service=1" --no-recreate
  ok "Blue-green rollout for '$service' complete."
}

# Build/pull then rollout per service
rollout_service(){
  local s="$1"; local mode="$2"; local timeout_s="$3"
  case "$s" in
    app|worker-arq|worker-monitor)
      info "Building image for $s..."
      if ((pull==1)); then
        docker compose "${args[@]}" build --pull "$s" | cat || true
      else
        docker compose "${args[@]}" build "$s" | cat || true
      fi
      ;;
  esac
  if [[ "$mode" == "blue_green" ]]; then
    blue_green_rollout "$s" "$timeout_s"
  else
    info "Recreating: $s"
    docker compose "${args[@]}" up -d --no-deps --force-recreate "$s"
    ok "$s restarted"
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
      traefik|loki|redis|docker-proxy|pgsql)
        rollout_service "$s" recreate
        ;;
      *) err "unknown component: $s"; exit 1 ;;
    esac
  done
fi

# Apply database migrations
if ((skip_components==0)) && [[ "$comps" == *"app"* ]] && ((migrate==1)); then
  info "Running migrations..."
  scripts/prod/db-migrate.sh --app-dir "$app_dir" --env-file .env
fi

# Update install metadata (version.json)
commit=$(git rev-parse --verify HEAD)
if [[ -z "$ref" ]]; then
  ref=$(git describe --tags --exact-match 2>/dev/null || true)
  [[ -n "$ref" ]] || ref=$(git describe --tags --abbrev=0 2>/dev/null || true)
  [[ -n "$ref" ]] || ref=$(git rev-parse --short "$commit")
fi
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[[ -d /var/lib/devpush ]] || install -d -m 0755 /var/lib/devpush || true
old_id="$(jq -r '.install_id' /var/lib/devpush/version.json 2>/dev/null || true)"
[[ -n "$old_id" && "$old_id" != "null" ]] || old_id=$(cat /proc/sys/kernel/random/uuid)
{ printf '{"install_id":"%s","git_ref":"%s","git_commit":"%s","updated_at":"%s"}\n' "$old_id" "$ref" "$commit" "$ts"; } > /var/lib/devpush/version.json

ok "Apply complete to $ref"

# Send telemetry
payload=$(jq -c --arg ev "update" '. + {event: $ev}' /var/lib/devpush/version.json 2>/dev/null || echo "")
if [[ -n "$payload" ]]; then
  curl -fsSL -X POST -H 'Content-Type: application/json' -d "$payload" https://api.devpu.sh/v1/telemetry >/dev/null 2>&1 || true
fi