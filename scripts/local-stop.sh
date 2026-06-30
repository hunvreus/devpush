#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PORT="7429"
PID_FILE="$ROOT_DIR/.tmp/devpush-dev.pid"

stop_pid() {
  pid="$1"
  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid"
    i=0
    while kill -0 "$pid" >/dev/null 2>&1 && [ "$i" -lt 30 ]; do
      sleep 0.2
      i=$((i + 1))
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
}

if [ -f "$PID_FILE" ]; then
  stop_pid "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1; then
  lsof -tiTCP:"$PORT" -sTCP:LISTEN | while read -r pid; do
    stop_pid "$pid"
  done
fi

echo "devpush stopped on port $PORT."
