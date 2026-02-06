#!/bin/sh
set -e

if [ "$DEBUG" = "true" ]; then
  exec uv run --with debugpy python -Xfrozen_modules=off -m debugpy --listen 0.0.0.0:5678 -m uvicorn main:app --host 0.0.0.0 --port 8000 --loop uvloop --reload
else
  exec uv run uvicorn main:app --host 0.0.0.0 --port 8000 --loop uvloop --reload
fi
