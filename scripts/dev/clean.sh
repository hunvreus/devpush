#!/bin/bash
set -e

usage(){
  cat <<USG
Usage: clean.sh [--hard] [-h|--help]

Stop the local stack and clean dev data (use --hard for global cleanup).

  --hard    Stop/remove ALL containers/images (dangerous)
  -h, --help Show this help
USG
  exit 0
}
[ "$1" = "-h" ] || [ "$1" = "--help" ] && usage

hard=0
for a in "$@"; do
  [ "$a" = "--hard" ] && hard=1
done

echo "Cleaning up local environment..."

if ((hard==1)); then
  echo "Stopping and removing ALL containers/images (dangerous)..."
  docker ps -aq | xargs -r docker stop || true
  docker ps -aq | xargs -r docker rm || true
  docker images -aq | xargs -r docker rmi -f || true
else
  command -v docker-compose >/dev/null 2>&1 || { echo "docker-compose not found"; exit 1; }
  docker-compose -p devpush -f docker-compose.yml -f docker-compose.override.dev.yml down --remove-orphans || true
  docker-compose -p devpush -f docker-compose.setup.yml down --remove-orphans || true
fi

docker network rm devpush_default >/dev/null 2>&1 || true
docker network rm devpush_internal >/dev/null 2>&1 || true

rm -rf ./data/traefik/* ./data/upload/* 2>/dev/null || true
mkdir -p ./data/traefik ./data/upload

echo "Clean complete."