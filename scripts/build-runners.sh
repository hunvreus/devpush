#!/usr/bin/env bash
set -Eeuo pipefail

# Capture stderr for error reporting
SCRIPT_ERR_LOG="/tmp/build_runners_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER_DIR="$PROJECT_ROOT/docker/runner"

usage(){
  cat <<USG
Usage: build-runners.sh [--no-cache] [--image IMAGE] [-h|--help]

Build runner images from docker/runner/* Dockerfiles.

  --no-cache          Force rebuild without cache (default: use cache)
  --image NAME        Build only the specified image (e.g. node-20)
  -h, --help          Show this help
USG
  exit 0
}

# Parse CLI flags
no_cache=0
target_image=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-cache) no_cache=1; shift ;;
    --image) target_image="$2"; shift 2 ;;
    --image=*) target_image="${1#*=}"; shift ;;
    -h|--help) usage ;;
    *) printf "Unknown option: %s\n" "$1"; usage ;;
  esac
done

# Validate prerequisites
if ! command -v docker >/dev/null 2>&1; then
  printf "docker not found in PATH; install Docker before building runners.\n" >&2
  exit 1
fi

if [[ ! -d "$RUNNER_DIR" ]]; then
  printf "Runner directory not found: %s (skipping)\n" "$RUNNER_DIR"
  exit 0
fi

printf "Building runner images...\n"

# Build images
found=0
for dockerfile in "$RUNNER_DIR"/Dockerfile.*; do
  [[ -f "$dockerfile" ]] || continue
  name="$(basename "$dockerfile" | sed 's/^Dockerfile\.//')"

  if [[ -n "$target_image" && "$name" != "$target_image" ]]; then
    continue
  fi
  
  found=1
  printf "  - runner-%s\n" "$name"
  if ((no_cache==1)); then
    docker build --no-cache -f "$dockerfile" -t "runner-$name" "$RUNNER_DIR"
  else
    docker build -f "$dockerfile" -t "runner-$name" "$RUNNER_DIR"
  fi
done

# Summary
if ((found==0)); then
  if [[ -n "$target_image" ]]; then
    printf "Runner image '%s' not found under %s\n" "$target_image" "$RUNNER_DIR"
  else
    printf "No runner Dockerfiles found under %s\n" "$RUNNER_DIR"
  fi
else
  printf "Runner images built successfully.\n"
fi
