#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
SCRIPT_ERR_LOG="/tmp/update_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; echo -e "${RED}Update failed (exit $s)${NC}"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || echo "No error details captured"; if [[ -n "${current_commit:-}" ]]; then echo -e "To rollback: cd $APP_DIR && git reset --hard $current_commit"; fi; exit $s' ERR

usage(){
  cat <<USG
Usage: update.sh [--ref <tag>] [--include-prerelease] [--all | --components app,worker-arq,worker-monitor,alloy | --full] [--no-pull] [--no-migrate] [--no-telemetry] [--yes|-y] [--ssl-provider <name>] [--verbose]

Update /dev/push by Git tag; performs rollouts (blue-green rollouts or simple restarts).

  --ref TAG         Git tag to update to (default: latest tag)
  --include-prerelease  Allow beta/rc tags when selecting latest
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

ref=""; comps=""; do_all=0; do_full=0; pull=1; migrate=1; include_pre=0; yes=0; telemetry=1; ssl_provider=""
[[ "${NO_TELEMETRY:-0}" == "1" ]] && telemetry=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --include-prerelease) include_pre=1; shift ;;
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

cd "$APP_DIR" || { err "app dir not found: $APP_DIR"; exit 1; }

# Check for uncommitted changes
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo -e "${YEL}Warning:${NC} Working directory has uncommitted changes."
  if [[ ! -t 0 ]]; then
    if ((yes==0)); then
      err "Cannot proceed in non-interactive mode without --yes flag"
      exit 1
    fi
  else
    read -r -p "Continue anyway? This will discard local changes. [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
  fi
fi

# Save current commit for rollback reference
current_commit=$(git rev-parse HEAD 2>/dev/null || true)
current_version=$(git describe --tags 2>/dev/null || echo "$current_commit")

# Resolve ref, fetch, then exec the updated apply script
printf "\n"
echo "Resolving update target..."
if [[ -z "$ref" ]]; then
  run_cmd "${CHILD_MARK} Fetching tags..." git fetch --tags --quiet origin
  if ((include_pre==1)); then
    ref="$(git tag -l --sort=version:refname | tail -1 || true)"
  else
    ref="$(git tag -l --sort=version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | tail -1 || true)"
    [[ -n "$ref" ]] || ref="$(git tag -l --sort=version:refname | tail -1 || true)"
  fi
  [[ -n "$ref" ]] || ref="main"
  echo -e "  ${DIM}${CHILD_MARK} Target: $ref${NC}"
fi

printf "\n"
echo "Fetching update..."
run_cmd "${CHILD_MARK} Fetching ref: $ref" bash -c "git fetch --depth 1 origin refs/tags/$ref || git fetch --depth 1 origin $ref"
run_cmd "${CHILD_MARK} Checking out..." git reset --hard FETCH_HEAD

bash scripts/prod/update-apply.sh --ref "$ref" "$@"
