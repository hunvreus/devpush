#!/bin/bash
set -e

exec 2> >(tee /tmp/restart_error.log >&2)

echo "Restarting local development stack..."

scripts/dev/stop.sh
scripts/dev/start.sh

echo "Development stack restarted."