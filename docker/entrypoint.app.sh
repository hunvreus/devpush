#!/bin/sh
set -e

exec uv run uvicorn main:app --host 0.0.0.0 --port 8000 --loop uvloop --workers 4 --proxy-headers --forwarded-allow-ips='*'