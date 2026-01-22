#!/bin/sh
set -e

exec uv run arq --watch /app workers.jobs.WorkerSettings