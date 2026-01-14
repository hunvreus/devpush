#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

usage(){
  cat <<USG
Usage: runner-exec.sh <deployment-id> [command...]

Execute a command inside the runner container for a deployment.

Examples:
  scripts/runner-exec.sh 685802df5caf6c5ebc2c12074ecb78ed ls -la /data
  scripts/runner-exec.sh 685802df5caf6c5ebc2c12074ecb78ed bash -lc 'ls -la /data'
  scripts/runner-exec.sh 685802df5caf6c5ebc2c12074ecb78ed
USG
  exit 0
}

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
fi

if [[ $# -lt 1 ]]; then
  usage
fi

deployment_id="$1"
shift

short_id="${deployment_id:0:7}"
container_name="runner-${short_id}"

container_id="$(docker ps --filter "name=^/${container_name}$" --format "{{.ID}}")"
if [[ -z "$container_id" ]]; then
  printf "Error: runner container not found for deployment %s (expected: %s)\n" "$deployment_id" "$container_name" >&2
  exit 1
fi

printf "Executing in %s (%s)\n" "$container_name" "$container_id"
if [[ $# -eq 0 ]]; then
  docker exec -it "$container_id" /bin/sh
else
  docker exec -i "$container_id" "$@"
fi
