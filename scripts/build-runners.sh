#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

[[ $EUID -eq 0 ]] || { printf "This script must be run as root (sudo).\n" >&2; exit 1; }

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

printf "Building runner images...\n"
build_runner_images "${args[@]}"
