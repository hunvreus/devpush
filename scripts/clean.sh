#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "clean"

usage(){
  cat <<USG
Usage: clean.sh [--keep-docker] [--keep-data] [--yes] [-h|--help]

Stop services and remove all Docker resources and data directory.

  --keep-docker   Keep Docker resources (containers, volumes, networks, images)
  --keep-data     Keep data directory
  --yes           Skip confirmation prompts
  -h, --help      Show this help
USG
  exit 0
}

# Parse CLI flags
keep_docker=0
keep_data=0
yes_flag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-docker) keep_docker=1; shift ;;
    --keep-data) keep_data=1; shift ;;
    --yes|-y) yes_flag=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Validate flags
if ((keep_docker==1)) && ((keep_data==1)); then
  err "Cannot use both --keep-docker and --keep-data. Nothing would be cleaned."
  exit 1
fi

# Confirmation prompt
if ((yes_flag==0)); then
  printf '\n'
  msg="This will stop services"
  if ((keep_docker==0)); then
    msg+=" and remove all Docker resources"
  fi
  if ((keep_data==0)); then
    msg+=" and data directory"
  fi
  msg+="."
  printf "${YEL}%s${NC}\n" "$msg"
  if [[ "$ENVIRONMENT" == "production" ]]; then
    printf "${RED}WARNING:${NC} You are running in production.\n"
  fi
  printf '\n'
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf "Aborted.\n"; exit 0; }
fi

# Stop services
printf '\n'
run_cmd --try "Stopping services" bash "$SCRIPT_DIR/stop.sh" --hard

# Remove Docker resources
if ((keep_docker==0)); then
  printf '\n'
  printf "Removing Docker resources\n"

  # Containers
  compose_containers="$(docker ps -a --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null || true)"
  runner_containers="$(docker ps -a --filter "label=devpush.deployment_id" -q 2>/dev/null || true)"
  containers="$(printf "%s\n%s" "$compose_containers" "$runner_containers" | grep -v '^\s*$' | sort -u || true)"
  if [[ -n "$containers" ]]; then
    count=$(printf '%s\n' "$containers" | wc -l | tr -d ' ')
    run_cmd --try "${CHILD_MARK} Removing containers ($count found)" docker rm -f $containers
  else
    printf "%s Removing containers (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
  fi

  # Volumes
  volumes=$(docker volume ls --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null || true)
  if [[ -n "$volumes" ]]; then
    count=$(printf '%s\n' "$volumes" | wc -l | tr -d ' ')
    run_cmd --try "${CHILD_MARK} Removing volumes ($count found)" docker volume rm $volumes
  else
    printf "%s Removing volumes (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
  fi

  # Networks
  networks=$(docker network ls --filter "name=devpush" -q 2>/dev/null || true)
  if [[ -n "$networks" ]]; then
    count=$(printf '%s\n' "$networks" | wc -l | tr -d ' ')
    run_cmd --try "${CHILD_MARK} Removing networks ($count found)" docker network rm $networks
  else
    printf "%s Removing networks (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
  fi

  # Images
  compose_images="$(docker images --filter "reference=devpush*" -q 2>/dev/null || true)"
  legacy_runner_images="$(docker images --filter "reference=runner-*" -q 2>/dev/null || true)"
  runner_images="$(docker images --filter "reference=ghcr.io/devpushhq/runner-*" -q 2>/dev/null || true)"
  override_images=""
  if [[ -f "$DATA_DIR/registry/overrides.json" ]]; then
    override_refs="$(
      jq -r '.. | objects | .image? // empty' "$DATA_DIR/registry/overrides.json" 2>/dev/null \
        | grep -v '^ghcr.io/devpushhq/runner-' \
        | sort -u || true
    )"
    if [[ -n "$override_refs" ]]; then
      while IFS= read -r ref; do
        [[ -n "$ref" ]] || continue
        ref_images="$(docker images --filter "reference=$ref" -q 2>/dev/null || true)"
        if [[ -n "$ref_images" ]]; then
          override_images="$(printf "%s\n%s" "$override_images" "$ref_images")"
        fi
      done <<< "$override_refs"
    fi
  fi
  images="$(printf "%s\n%s\n%s\n%s" "$compose_images" "$legacy_runner_images" "$runner_images" "$override_images" | grep -v '^\s*$' | sort -u || true)"
  if [[ -n "$images" ]]; then
    count=$(printf '%s\n' "$images" | wc -l | tr -d ' ')
    run_cmd --try "${CHILD_MARK} Removing images ($count found)" docker rmi -f $images
  else
    printf "%s Removing images (0 found) ${YEL}⊘${NC}\n" "${CHILD_MARK}"
  fi
fi

# Remove data directory
if ((keep_data==0)); then
  printf '\n'
  run_cmd --try "Removing data directory" rm -rf "$DATA_DIR"
fi

# Success
printf '\n'
printf "${GRN}Clean up complete. ✔${NC}\n"
