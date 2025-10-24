#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Capture stderr for error reporting
exec 2> >(tee /tmp/update_error.log >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; echo -e "${RED}Update failed (exit $s)${NC}"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/update_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage(){
  cat <<USG
Usage: update.sh [--app-dir <path>] [--ref <tag>] [--include-prerelease] [--all | --components app,worker-arq,worker-monitor | --full] [--no-pull] [--no-migrate] [--no-telemetry] [--yes|-y] [--ssl-provider <name>] [--verbose]

Update /dev/push by Git tag; performs rollouts (blue-green rollouts or simple restarts).

  --app-dir PATH    App directory (default: $PWD)
  --ref TAG         Git tag to update to (default: latest tag)
  --include-prerelease  Allow beta/rc tags when selecting latest
  --all             Update app,worker-arq,worker-monitor
  --components CSV  Comma-separated list of services to update
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

app_dir="${APP_DIR:-$(pwd)}"; ref=""; comps=""; do_all=0; do_full=0; pull=1; migrate=1; include_pre=0; yes=0; skip_components=0; telemetry="${NO_TELEMETRY:-1}"; ssl_provider=""
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
    --no-telemetry) telemetry=0; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    --yes|-y) yes=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

# Resolve ref, fetch, then exec the updated apply script
printf "\n"
echo "Resolving update target..."
if [[ -z "$ref" ]]; then
  run_cmd "  ${CHILD_MARK} Fetching tags..." git fetch --tags --quiet origin
  if ((include_pre==1)); then
    ref="$(git tag -l --sort=version:refname | tail -1 || true)"
  else
    ref="$(git tag -l --sort=version:refname '[0-9]*\.[0-9]*\.[0-9]*' | tail -1 || true)"
    [[ -n "$ref" ]] || ref="$(git tag -l --sort=version:refname | tail -1 || true)"
  fi
  [[ -n "$ref" ]] || ref="main"
  echo "  ${CHILD_MARK} Target: $ref"
fi

printf "\n"
echo "Fetching update..."
run_cmd "  ${CHILD_MARK} Fetching ref: $ref" bash -c "git fetch --depth 1 origin refs/tags/$ref || git fetch --depth 1 origin $ref"
run_cmd "  ${CHILD_MARK} Checking out..." git reset --hard FETCH_HEAD

exec scripts/prod/update-apply.sh "$@"