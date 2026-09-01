#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Validate devpush against a clean remote server.

Required environment:
  DEVPUSH_BASE_URL         Public control-plane URL, e.g. https://devpush.example.com
  DEVPUSH_REMOTE_HOST      SSH target, e.g. root@203.0.113.10
  DEVPUSH_INSTALL_COMMAND  Server install command copied from devpush

Optional environment:
  DEVPUSH_REMOTE_SSH_OPTS       Extra ssh flags, e.g. "-i ~/.ssh/devpush -p 2222"
  DEVPUSH_PROJECT_URL           App URL to curl after you trigger a deploy in the UI
  DEVPUSH_PROJECT_URL_TIMEOUT   Seconds to wait for the app route, default: 180
  DEVPUSH_PROJECT_URL_INTERVAL  Seconds between route checks, default: 5
  DEVPUSH_DOCKER_FILTER         docker ps filter to check after deploy, e.g. "name=my-project"
  DEVPUSH_FULL_PROOF            Set to 1 to require deployed route + Traefik checks
  DEVPUSH_REQUIRE_PROJECT_URL   Set to 1 to fail unless DEVPUSH_PROJECT_URL is set
  DEVPUSH_VALIDATE_TRAEFIK      Set to 1 to require the managed Traefik container
  DEVPUSH_TRAEFIK_CONTAINER     Traefik container name, default: devpush-traefik
  DEVPUSH_ALLOW_INSECURE_BASE_URL
                                  Set to 1 to allow non-HTTPS control-plane and route URLs
  DEVPUSH_REMOTE_SUMMARY_PATH   Success summary file, default: .tmp/remote-validation-<timestamp>.md
  DEVPUSH_REMOTE_DIAGNOSTICS    Set to 0 to disable best-effort failure diagnostics

Example:
  DEVPUSH_BASE_URL=https://devpush.example.com \
  DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
  DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
  scripts/validate-remote.sh
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    echo >&2
    usage >&2
    exit 2
  fi
}

required DEVPUSH_BASE_URL
required DEVPUSH_REMOTE_HOST
required DEVPUSH_INSTALL_COMMAND

DEVPUSH_BASE_URL="${DEVPUSH_BASE_URL%/}"
CURRENT_STEP="initializing"
RUN_STARTED_AT="$(date -u "+%Y-%m-%d %H:%M:%S UTC")"
RUN_ID="$(date -u "+%Y%m%dT%H%M%SZ")"
SUMMARY_PATH="${DEVPUSH_REMOTE_SUMMARY_PATH:-.tmp/remote-validation-${RUN_ID}.md}"

if [[ "$DEVPUSH_BASE_URL" != https://* && "${DEVPUSH_ALLOW_INSECURE_BASE_URL:-}" != "1" ]]; then
  echo "DEVPUSH_BASE_URL must use https:// for remote validation. Set DEVPUSH_ALLOW_INSECURE_BASE_URL=1 only for local or private test networks." >&2
  exit 2
fi

if [[ "${DEVPUSH_FULL_PROOF:-}" == "1" ]]; then
  DEVPUSH_REQUIRE_PROJECT_URL="1"
  DEVPUSH_VALIDATE_TRAEFIK="1"
fi

if [[ "${DEVPUSH_REQUIRE_PROJECT_URL:-}" == "1" && -z "${DEVPUSH_PROJECT_URL:-}" ]]; then
  echo "DEVPUSH_PROJECT_URL is required when DEVPUSH_REQUIRE_PROJECT_URL=1 or DEVPUSH_FULL_PROOF=1." >&2
  exit 2
fi

if [[ -n "${DEVPUSH_PROJECT_URL:-}" && "$DEVPUSH_PROJECT_URL" != https://* && "${DEVPUSH_ALLOW_INSECURE_BASE_URL:-}" != "1" ]]; then
  echo "DEVPUSH_PROJECT_URL must use https:// for remote validation. Set DEVPUSH_ALLOW_INSECURE_BASE_URL=1 only for local or private test networks." >&2
  exit 2
fi

SSH_OPTS=()
if [[ -n "${DEVPUSH_REMOTE_SSH_OPTS:-}" ]]; then
  read -r -a SSH_OPTS <<< "$DEVPUSH_REMOTE_SSH_OPTS"
fi

remote() {
  ssh "${SSH_OPTS[@]}" "$DEVPUSH_REMOTE_HOST" "$@"
}

remote_sudo() {
  local command="$1"
  local quoted_command
  printf -v quoted_command '%q' "$command"
  remote "if [ \"\$(id -u)\" -eq 0 ]; then sh -c $quoted_command; else sudo sh -c $quoted_command; fi"
}

remote_devpush() {
  local command="$1"
  local quoted_command
  printf -v quoted_command '%q' "$command"
  remote_sudo "if command -v runuser >/dev/null 2>&1; then runuser -u devpush -- sh -c $quoted_command; elif command -v sudo >/dev/null 2>&1; then sudo -u devpush sh -c $quoted_command; else su -s /bin/sh devpush -c $quoted_command; fi"
}

step() {
  CURRENT_STEP="$1"
  printf '\n==> %s\n' "$1"
}

write_success_summary() {
  mkdir -p "$(dirname "$SUMMARY_PATH")"
  {
    printf '# Remote validation\n\n'
    printf '- Status: passed\n'
    printf '- Started at: %s\n' "$RUN_STARTED_AT"
    printf '- Finished at: %s\n' "$(date -u "+%Y-%m-%d %H:%M:%S UTC")"
    printf '- Control plane: %s\n' "$DEVPUSH_BASE_URL"
    printf '- Remote host: %s\n' "$DEVPUSH_REMOTE_HOST"
    printf '- Full proof: %s\n' "${DEVPUSH_FULL_PROOF:-0}"
    printf '- Managed Traefik checked: %s\n' "${DEVPUSH_VALIDATE_TRAEFIK:-0}"
    printf '- Deployed route checked: %s\n' "${DEVPUSH_PROJECT_URL:-not checked}"
    printf '- Docker filter checked: %s\n' "${DEVPUSH_DOCKER_FILTER:-not checked}"
    printf '- Insecure URL override: %s\n' "${DEVPUSH_ALLOW_INSECURE_BASE_URL:-0}"
    printf '\nThe install command is intentionally not recorded because it contains the server enrollment token.\n'
  } > "$SUMMARY_PATH"
  printf 'Wrote validation summary: %s\n' "$SUMMARY_PATH"
}

diagnose_failure() {
  local status="$1"

  if [[ "$status" -eq 0 || "${DEVPUSH_REMOTE_DIAGNOSTICS:-1}" == "0" ]]; then
    return "$status"
  fi

  set +e
  {
    echo
    echo "Remote validation failed during: ${CURRENT_STEP}"
    echo "Exit status: ${status}"
    echo
    echo "Best-effort diagnostics:"
  } >&2

  if [[ -n "${DEVPUSH_REMOTE_HOST:-}" ]]; then
    echo "-- remote uname" >&2
    remote 'uname -a' >&2 || true

    echo "-- devpush-agent service" >&2
    remote_sudo 'systemctl status devpush-agent --no-pager --lines=30' >&2 || true

    echo "-- devpush-agent logs" >&2
    remote_sudo 'journalctl -u devpush-agent --no-pager -n 80' >&2 || true

    echo "-- docker containers" >&2
    remote_sudo 'docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"' >&2 || true

    echo "-- docker networks" >&2
    remote_sudo 'docker network ls' >&2 || true

    echo "-- possible port listeners" >&2
    remote_sudo 'if command -v ss >/dev/null 2>&1; then ss -ltnp "( sport = :80 or sport = :443 )"; elif command -v lsof >/dev/null 2>&1; then lsof -iTCP:80 -iTCP:443 -sTCP:LISTEN; else echo "ss/lsof unavailable"; fi' >&2 || true
  fi

  return "$status"
}

on_error() {
  local status="$?"
  diagnose_failure "$status"
  exit "$status"
}

trap on_error ERR

step "Checking control-plane installer endpoints"
curl -fsSI --retry 3 --retry-delay 2 --connect-timeout 5 "$DEVPUSH_BASE_URL/api/install/agent" >/dev/null
curl -fsSI --retry 3 --retry-delay 2 --connect-timeout 5 "$DEVPUSH_BASE_URL/api/install/agent/binary" >/dev/null

step "Checking remote host prerequisites"
remote 'command -v curl >/dev/null'
remote 'command -v systemctl >/dev/null'
remote 'if [ "$(id -u)" -ne 0 ]; then command -v sudo >/dev/null; fi'
remote 'uname -a'
remote_sudo 'if command -v ss >/dev/null 2>&1; then ss -ltnp "( sport = :80 or sport = :443 )" || true; fi'
validation_started_at="$(remote 'date -u "+%Y-%m-%d %H:%M:%S UTC"')"
printf 'Remote validation start: %s\n' "$validation_started_at"

step "Running devpush server install command"
printf '%s\n' "$DEVPUSH_INSTALL_COMMAND" | ssh "${SSH_OPTS[@]}" "$DEVPUSH_REMOTE_HOST" 'bash -se'

step "Checking installed agent"
remote 'test -x /usr/local/bin/devpush-agent'
remote_sudo 'test -f /etc/devpush/agent.env'
remote_sudo 'id devpush >/dev/null'
for attempt in {1..15}; do
  if remote_sudo 'systemctl is-active --quiet devpush-agent'; then
    break
  fi
  if [[ "$attempt" -eq 15 ]]; then
    remote_sudo 'systemctl status devpush-agent --no-pager --lines=50'
    remote_sudo 'journalctl -u devpush-agent --no-pager -n 100'
    exit 1
  fi
  sleep 2
done
remote_sudo 'systemctl status devpush-agent --no-pager --lines=20'
remote_sudo 'journalctl -u devpush-agent --no-pager -n 30'

step "Checking agent control-plane activity"
printf -v journal_since_arg '%q' "$validation_started_at"
for attempt in {1..10}; do
  if remote_sudo "journalctl -u devpush-agent --no-pager --since $journal_since_arg | grep -E 'registered agent|heartbeat' >/dev/null"; then
    break
  fi
  if [[ "$attempt" -eq 10 ]]; then
    echo "devpush-agent logs do not show fresh registration or heartbeat activity." >&2
    remote_sudo "journalctl -u devpush-agent --no-pager --since $journal_since_arg"
    exit 1
  fi
  sleep 3
done

step "Checking Docker"
remote_sudo 'docker version >/dev/null'
remote_sudo 'docker compose version >/dev/null'
remote_devpush 'docker version >/dev/null'
remote_devpush 'docker compose version >/dev/null'

if [[ "${DEVPUSH_VALIDATE_TRAEFIK:-}" == "1" ]]; then
  step "Checking managed Traefik"
  traefik_container="${DEVPUSH_TRAEFIK_CONTAINER:-devpush-traefik}"
  remote_sudo "docker ps --filter name='^/${traefik_container}$' --filter status=running --format '{{.Names}}' | grep -Fx '$traefik_container'"
  remote_sudo "docker port '$traefik_container' 80 >/dev/null"
fi

if [[ -n "${DEVPUSH_DOCKER_FILTER:-}" ]]; then
  step "Checking deployed containers"
  remote_sudo "docker ps --filter '$DEVPUSH_DOCKER_FILTER' --format '{{.Names}}' | grep ."
fi

route_checked=0
if [[ -n "${DEVPUSH_PROJECT_URL:-}" ]]; then
  step "Checking deployed route"
  route_timeout="${DEVPUSH_PROJECT_URL_TIMEOUT:-180}"
  route_interval="${DEVPUSH_PROJECT_URL_INTERVAL:-5}"
  route_deadline=$((SECONDS + route_timeout))

  while true; do
    if curl -fsS --connect-timeout 5 --max-time 20 "$DEVPUSH_PROJECT_URL" >/dev/null; then
      break
    fi

    if [[ "$SECONDS" -ge "$route_deadline" ]]; then
      echo "Timed out waiting for route: $DEVPUSH_PROJECT_URL" >&2
      echo "Remote Docker containers:" >&2
      remote_sudo 'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'
      echo "Remote Docker networks:" >&2
      remote_sudo 'docker network ls'
      echo "Recent agent logs:" >&2
      remote_sudo 'journalctl -u devpush-agent --no-pager -n 100'
      exit 1
    fi

    sleep "$route_interval"
  done
  route_checked=1
fi

write_success_summary

cat <<'EOF'

Remote server install validation passed.

Final proof:
  1. Confirm the server is Online in devpush.
  2. Create a GitHub-backed project with a Compose file.
  3. Trigger Deploy.
  4. Confirm the deployment reaches Succeeded.
  5. Run pnpm validate:remote:proof with DEVPUSH_PROJECT_URL set.
EOF
