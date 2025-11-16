#!/bin/bash
set -e

# Capture stderr for error reporting
exec 2> >(tee /tmp/start_error.log >&2)

usage(){
  cat <<USG
Usage: start.sh [--cache] [--prune] [--setup] [-h|--help]

Start the local development stack (streams logs).

  --cache    Use build cache (default: no cache)
  --prune    Prune dangling images before build
  --setup    Start in setup mode (allows access without hostname)
  -h, --help Show this help
USG
  exit 0
}
[ "$1" = "-h" ] || [ "$1" = "--help" ] && usage

command -v docker-compose >/dev/null 2>&1 || { echo "docker-compose not found"; echo "Error details:"; cat /tmp/start_error.log 2>/dev/null || echo "No error details captured"; exit 1; }

echo "Starting local environment..."

mkdir -p ./data/{traefik,upload}

# Seed config.json if missing
if [ ! -f ./data/config.json ]; then
  echo "Seeding ./data/config.json..."
  cat > ./data/config.json <<'JSON'
{}
JSON
  chmod 0644 ./data/config.json || true
fi

no_cache=0
prune=0
setup_mode=0
for a in "$@"; do
  [ "$a" = "--cache" ] && no_cache=0
  [ "$a" = "--no-cache" ] && no_cache=1
  [ "$a" = "--prune" ] && prune=1
  [ "$a" = "--setup" ] && setup_mode=1
done

((prune==1)) && { echo "Pruning dangling images..."; docker image prune -f; }

# Build runner images
if ((no_cache==1)); then
  ./scripts/dev/build-runners.sh --no-cache
else
  ./scripts/dev/build-runners.sh
fi

# Optional no-cache build for services
if ((setup_mode==1)); then
  echo "Starting in SETUP MODE (minimal stack, direct port access)..."
  args=(-p devpush -f docker-compose.setup.yml)
else
  args=(-p devpush -f docker-compose.yml -f docker-compose.override.dev.yml)
fi

if ((no_cache==1)); then
  echo "Building services with --no-cache..."
  docker-compose "${args[@]}" build --no-cache
fi

echo "Stopping any running stack..."
docker-compose "${args[@]}" down || true

if ((setup_mode==1)); then
  echo "Starting minimal setup stack with logs (Ctrl+C to stop foreground)..."
  echo "Access setup at: http://localhost/setup"
else
  echo "Starting stack with logs (Ctrl+C to stop foreground)..."
fi
docker-compose "${args[@]}" up --build --force-recreate
