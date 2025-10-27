#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_ERR_LOG="/tmp/restart_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

source "$(dirname "$0")/lib.sh"

trap 's=$?; err "Restart failed (exit $s)"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage(){
  cat <<USG
Usage: restart.sh [--env-file <path>] [--no-pull] [--migrate] [--ssl-provider <name>] [--verbose]

Restart production services; optionally run DB migrations after start.

  --env-file PATH   Path to .env (default: ./\.env)
  --no-pull         Do not pass --pull always to docker compose up
  --migrate         Run DB migrations after starting
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure
  -v, --verbose     Enable verbose output for debugging
  -h, --help        Show this help
USG
  exit 0
}

app_dir="/home/devpush/devpush"; envf=".env"; pull_always=1; do_migrate=0; ssl_provider=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) envf="$2"; shift 2 ;;
    --no-pull) pull_always=0; shift ;;
    --migrate) do_migrate=1; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

printf "\n"
echo "Restarting services..."
scripts/prod/stop.sh
scripts/prod/start.sh --env-file "$envf" $( ((pull_always==0)) && echo --no-pull ) $( ((do_migrate==1)) && echo --migrate ) ${ssl_provider:+--ssl-provider "$ssl_provider"}

printf "\n"
echo -e "${GRN}Services restarted. ✔${NC}"