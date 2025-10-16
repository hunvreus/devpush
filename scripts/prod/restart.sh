#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

source "$(dirname "$0")/lib.sh"

usage(){
  cat <<USG
Usage: restart.sh [--app-dir <path>] [--env-file <path>] [--no-pull] [--migrate] [--ssl-provider <name>]

Restart production services; optionally run DB migrations after start.

  --app-dir PATH    App directory (default: $PWD)
  --env-file PATH   Path to .env (default: ./\.env)
  --no-pull         Do not pass --pull always to docker compose up
  --migrate         Run DB migrations after starting
  --ssl-provider    One of: default|cloudflare|route53|gcloud|digitalocean|azure
  -h, --help        Show this help
USG
  exit 0
}

app_dir="${APP_DIR:-$(pwd)}"; envf=".env"; pull_always=1; do_migrate=0; ssl_provider=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) app_dir="$2"; shift 2 ;;
    --env-file) envf="$2"; shift 2 ;;
    --no-pull) pull_always=0; shift ;;
    --migrate) do_migrate=1; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

cd "$app_dir" || { err "app dir not found: $app_dir"; exit 1; }

info "Restarting services..."
scripts/prod/stop.sh --app-dir "$app_dir"
scripts/prod/start.sh --app-dir "$app_dir" --env-file "$envf" $( ((pull_always==0)) && echo --no-pull ) $( ((do_migrate==1)) && echo --migrate ) ${ssl_provider:+--ssl-provider "$ssl_provider"}
ok "Restarted."