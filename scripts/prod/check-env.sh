#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

RED="$(printf '\033[31m')"; GRN="$(printf '\033[32m')"; YEL="$(printf '\033[33m')"; BLD="$(printf '\033[1m')"; NC="$(printf '\033[0m')"
err(){ echo -e "${RED}ERR:${NC} $*" >&2; }
ok(){ echo -e "${GRN}$*${NC}"; }

usage(){
  cat <<USG
Usage: check-env.sh [--env-file <path>] [--quiet]

Validate that all required environment variables are present and non-empty in .env file.

  --env-file PATH   Path to .env (default: ./.env)
  --quiet           Print only errors
USG
  exit 1
}

envf=".env"; quiet=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) envf="$2"; shift 2 ;;
    --quiet) quiet=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

[[ -f "$envf" ]] || { err "Not found: $envf"; exit 1; }

# Required keys (excluding email config which has alternatives)
req=(
  LE_EMAIL APP_HOSTNAME DEPLOY_DOMAIN EMAIL_SENDER_ADDRESS
  GITHUB_APP_ID GITHUB_APP_NAME GITHUB_APP_PRIVATE_KEY GITHUB_APP_WEBHOOK_SECRET
  GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET
  SECRET_KEY ENCRYPTION_KEY POSTGRES_PASSWORD SERVER_IP
)

missing=()
for k in "${req[@]}"; do
  v="$(awk -F= -v k="$k" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g')"
  [[ -n "$v" ]] || missing+=("$k")
done

# Check email configuration - either RESEND_API_KEY or all SMTP settings
resend_key="$(awk -F= -v k="RESEND_API_KEY" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g')"
smtp_host="$(awk -F= -v k="SMTP_HOST" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g')"
smtp_port="$(awk -F= -v k="SMTP_PORT" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g')"
smtp_username="$(awk -F= -v k="SMTP_USERNAME" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g')"
smtp_password="$(awk -F= -v k="SMTP_PASSWORD" '$1==k{sub(/^[^=]*=/,""); print}' "$envf" | sed 's/^"\|"$//g')"

if [[ -n "$resend_key" ]]; then
  # RESEND_API_KEY is set, email config is valid
  :
elif [[ -n "$smtp_host" && -n "$smtp_port" && -n "$smtp_username" && -n "$smtp_password" ]]; then
  # All SMTP settings are set, email config is valid
  :
else
  # Neither RESEND_API_KEY nor complete SMTP config is present
  missing+=("RESEND_API_KEY or (SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD)")
fi

if ((${#missing[@]})); then
  err "Missing values in $envf: ${missing[*]}"
  exit 1
fi

((quiet==1)) || ok "$envf valid"