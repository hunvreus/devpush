#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PORT="7429"
PID_FILE="$ROOT_DIR/.tmp/devpush-dev.pid"

owns_pid() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  command -v lsof >/dev/null 2>&1 || return 1
  process_command="$(ps -p "$1" -o command= 2>/dev/null)" || return 1
  case "$process_command" in
    *node*fs-watch-error-guard.cjs*node_modules/vite/bin/vite.js\ dev*--port\ "$PORT"*--strictPort*) ;;
    *) return 1 ;;
  esac
  process_directory="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ "$process_directory" = "$ROOT_DIR/app" ]
}

stop_pid() {
  pid="$1"
  if owns_pid "$pid" && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid"
    i=0
    while kill -0 "$pid" >/dev/null 2>&1 && [ "$i" -lt 30 ]; do
      sleep 0.2
      i=$((i + 1))
    done
    if owns_pid "$pid" && kill -0 "$pid" >/dev/null 2>&1; then
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
