#!/bin/bash
set -e

usage(){
  cat <<USG
Usage: build-runners.sh [--no-cache] [--image IMAGE] [-h|--help]

Build local runner images from docker/runner/* Dockerfiles.

  --no-cache Force rebuild without cache (default: use cache)
  --image    Build specific image only (e.g., php-franken-8.3)
  -h, --help Show this help
USG
  exit 0
}
[ "$1" = "-h" ] || [ "$1" = "--help" ] && usage

echo "Building runner images..."

no_cache=0
target_image=""
for a in "$@"; do
  [ "$a" = "--no-cache" ] && no_cache=1
  [[ "$a" =~ ^--image=(.+)$ ]] && target_image="${BASH_REMATCH[1]}"
done

found=0
for dockerfile in docker/runner/Dockerfile.*; do
  [ -f "$dockerfile" ] || continue
  name=$(basename "$dockerfile" | sed 's/Dockerfile\.//')
  
  # Skip if specific image requested and this isn't it
  [ -n "$target_image" ] && [ "$name" != "$target_image" ] && continue
  
  found=1
  echo "Building runner-$name from $dockerfile..."
  if ((no_cache==1)); then
    docker build --no-cache -f "$dockerfile" -t "runner-$name" ./docker/runner
  else
    docker build -f "$dockerfile" -t "runner-$name" ./docker/runner
  fi
done

if ((found==0)); then
  echo "No runner Dockerfiles found under docker/runner/."
else
  echo "Runner images built successfully!"
fi
