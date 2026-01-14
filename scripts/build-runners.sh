#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "build-runners"

usage(){
  cat <<USG
Usage: build-runners.sh [--no-cache] [--image <name>] [-h|--help]

Build runner images defined in app/settings/images.json.

  --no-cache          Force rebuild without cache
  --image <name>      Build only the specified image (slug)
  -h, --help          Show this help
USG
  exit 0
}

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-cache|--image|--image=*)
      args+=("$1")
      [[ "$1" == "--image" ]] && args+=("$2") && shift
      shift
      ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

set_service_ids

printf "Building runner images\n"
if ((${#args[@]} > 0)); then
  build_runner_images "${args[@]}"
else
  build_runner_images
fi
