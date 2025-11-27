#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

[[ $EUID -eq 0 ]] || { printf "This script must be run as root (sudo).\n" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "update"
on_error_hook() {
  if [[ -n "${current_commit:-}" ]]; then
    printf "To rollback: cd %s && git reset --hard %s\n" "$APP_DIR" "$current_commit"
  fi
}

usage(){
  cat <<USG
Usage: update.sh [--ref <tag>] [--all | --components app,worker-arq,worker-monitor,alloy | --full] [--no-migrate] [--no-telemetry] [--yes|-y] [--ssl-provider <name>] [--verbose]

Update /dev/push by Git tag; performs rollouts (blue-green rollouts or simple restarts).

  --ref TAG         Git tag to update to (default: latest stable tag)
  --all             Update app,worker-arq,worker-monitor,alloy
  --components CSV  Comma-separated list of services to update (e.g. app,loki,alloy)
  --full            Full stack update (down whole stack, then up). Causes downtime
  --no-migrate      Do not run DB migrations after app update
  --no-telemetry    Do not send telemetry
  --yes, -y         Non-interactive yes to prompts
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

# Parse CLI flags
ref=""; comps=""; do_all=0; do_full=0; migrate=1; yes=0; telemetry=1; ssl_provider=""
[[ "${NO_TELEMETRY:-0}" == "1" ]] && telemetry=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --all) do_all=1; shift ;;
    --components) comps="$2"; shift 2 ;;
    --full) do_full=1; shift ;;
    --no-migrate) migrate=0; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    --yes|-y) yes=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

ensure_service_ids

# Guard: ensure setup completed before running updates
if ! is_setup_complete; then
  err "This script requires a completed setup. Run the setup wizard first."
  exit 1
fi

# Guard: prevent running in development mode
if [[ "$ENVIRONMENT" == "development" ]]; then
  err "update.sh is for production only. For development, simply pull code with git."
  exit 1
fi

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Check for uncommitted changes
if [[ -n "$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" status --porcelain 2>/dev/null)" ]]; then
  printf "${YEL}Working directory has uncommitted changes.${NC}\n"
  if [[ ! -t 0 ]]; then
    if ((yes==0)); then
      err "Cannot proceed in non-interactive mode without --yes flag"
      exit 1
    fi
  else
    read -r -p "Continue anyway? This will discard local changes. [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { printf "Aborted.\n"; exit 0; }
  fi
fi

# Save current commit for rollback reference
current_commit=$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)
current_version=$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" describe --tags 2>/dev/null || printf "%s\n" "$current_commit")

# Resolve ref, fetch, then exec the updated apply script
printf '\n'
printf "Resolving update target...\n"
if [[ -z "$ref" ]]; then
  run_cmd "${CHILD_MARK} Fetching tags..." runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" fetch --tags --quiet origin
  ref="$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" tag -l --sort=version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | tail -1 || true)"
  [[ -n "$ref" ]] || ref="$(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" tag -l --sort=version:refname | tail -1 || true)"
  [[ -n "$ref" ]] || ref="main"
  printf "  ${DIM}%s Using latest stable tag: %s${NC}\n" "$CHILD_MARK" "$ref"
else
  printf "  ${DIM}%s Using provided ref: %s${NC}\n" "$CHILD_MARK" "$ref"
fi

# Fetch update
printf '\n'
printf "Fetching update...\n"
run_cmd "${CHILD_MARK} Fetching ref: $ref" runuser -u "$SERVICE_USER" -- bash -c "cd \"$APP_DIR\" && git fetch --depth 1 origin refs/tags/$ref || git fetch --depth 1 origin $ref"
run_cmd "${CHILD_MARK} Checking out..." runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" reset --hard FETCH_HEAD

# Run update-apply script (allows us to update the script itself)
bash "$SCRIPT_DIR/update-apply.sh" --ref "$ref" "$@"
