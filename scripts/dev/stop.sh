#!/bin/bash
set -e

usage(){
  cat <<USG
Usage: stop.sh [-h|--help]

Stop the local development stack.

  -h, --help Show this help
USG
  exit 0
}
[ "$1" = "-h" ] || [ "$1" = "--help" ] && usage

command -v docker-compose >/dev/null 2>&1 || { echo "docker-compose not found"; exit 1; }

echo "Stopping development stack..."

# Try both dev and setup stacks
docker-compose -p devpush -f docker-compose.yml -f docker-compose.override.dev.yml stop 2>/dev/null || true
docker-compose -p devpush -f docker-compose.setup.yml stop 2>/dev/null || true

echo "Stack stopped."