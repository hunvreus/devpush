#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PORT="7429"
LIMA_INSTANCE="${DEVPUSH_LIMA_INSTANCE:-devpush-test}"
REQUIRE_LIMA="${DEVPUSH_REQUIRE_LIMA:-1}"
PID_FILE="$ROOT_DIR/.tmp/devpush-dev.pid"
LOG_FILE="$ROOT_DIR/.tmp/devpush-dev.log"

mkdir -p "$ROOT_DIR/.tmp"

if [ "$REQUIRE_LIMA" = "1" ]; then
  if ! command -v limactl >/dev/null 2>&1; then
    echo "limactl is required. Set DEVPUSH_REQUIRE_LIMA=0 to skip the Lima check." >&2
    exit 1
  fi

  lima_status="$(limactl list --format '{{.Name}} {{.Status}}' | awk -v name="$LIMA_INSTANCE" '$1 == name { print $2 }')"
  if [ -z "$lima_status" ]; then
    echo "Lima instance '$LIMA_INSTANCE' was not found. Set DEVPUSH_LIMA_INSTANCE to use another VM." >&2
    exit 1
  fi

  if [ "$lima_status" != "Running" ]; then
    limactl start "$LIMA_INSTANCE"
  fi
fi

if docker compose version >/dev/null 2>&1; then
  docker compose -f "$ROOT_DIR/deploy/compose.yml" up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f "$ROOT_DIR/deploy/compose.yml" up -d
else
  echo "Docker Compose is required for local Postgres." >&2
  exit 1
fi

pnpm --dir "$ROOT_DIR/app" db:migrate

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "devpush is already listening on port $PORT."
  exit 0
fi

cd "$ROOT_DIR/app"
nohup node -r ./scripts/fs-watch-error-guard.cjs ./node_modules/vite/bin/vite.js dev --host 0.0.0.0 --port "$PORT" --strictPort >"$LOG_FILE" 2>&1 &
echo "$!" >"$PID_FILE"

echo "devpush started on http://localhost:$PORT"
echo "Log: $LOG_FILE"
