#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "clean"

usage(){
  cat <<USG
Usage: clean.sh [--remove-all] [--remove-data] [--remove-containers] [--remove-images] [--yes] [-h|--help]

Stop the services and remove Docker data. Use --remove-all to remove data directory, containers and images.

  --remove-all      Remove data directory, containers and images (in addition to volumes/networks)
  --remove-data     Remove data directory
  --remove-containers Remove containers
  --remove-images   Remove images
  --yes             Skip confirmation prompts
  -h, --help        Show this help
USG
  exit 0
}

# Parse CLI flags
remove_all=0
remove_data=0
remove_containers=0
remove_images=0
yes_flag=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-all) remove_all=1; shift ;;
    --remove-data) remove_data=1; shift ;;
    --remove-containers) remove_containers=1; shift ;;
    --remove-images) remove_images=1; shift ;;
    --yes|-y) yes_flag=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

# Confirmation prompt
if ((yes_flag==0)); then
  printf '\n'
  printf "${YEL}This will stop docker compose services, remove volumes and networks, and delete the data directory.${NC}\n"
  if [[ "$ENVIRONMENT" == "production" ]]; then
    printf "${RED}WARNING:${NC} You are running in production.\n"
  fi
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf "Aborted.\n"; exit 0; }
fi

printf '\n'
run_cmd --try "Stopping services..." bash "$SCRIPT_DIR/stop.sh" --hard

# Remove Docker volumes
volumes=$(docker volume ls --filter "name=devpush" -q 2>/dev/null || true)
if [[ -n "$volumes" ]]; then
  volume_count=$(printf '%s\n' "$volumes" | wc -l | tr -d ' ')
  printf '\n'
  run_cmd --try "Removing volumes ($volume_count found)..." docker volume rm $volumes >/dev/null 2>&1 || true
fi

# Remove Docker networks
networks=$(docker network ls --filter "name=devpush" -q 2>/dev/null || true)
if [[ -n "$networks" ]]; then
  network_count=$(printf '%s\n' "$networks" | wc -l | tr -d ' ')
  printf '\n'
  run_cmd --try "Removing networks ($network_count found)..." docker network rm $networks >/dev/null 2>&1 || true
fi

if ((remove_data==1)) || ((remove_all==1)); then
  printf '\n'
  run_cmd --try "Removing data directory..." rm -rf "$DATA_DIR"
fi

# If remove containers or remove all, remove the containers
if ((remove_containers==1)) || ((remove_all==1)); then
  compose_containers="$(docker ps -a --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null || true)"
  runner_containers="$(docker ps -a --filter "label=devpush.deployment_id" -q 2>/dev/null || true)"
  containers="$(printf "%s\n%s\n" "$compose_containers" "$runner_containers" | grep -v '^\s*$' | sort -u || true)"
  if [[ -n "$containers" ]]; then
    run_cmd --try "Removing containers..." docker rm -f $containers >/dev/null 2>&1 || true
  else
    printf "Removing containers... ${YEL}⊘${NC}\n"
    printf "${DIM}${CHILD_MARK} No containers found${NC}\n"
  fi
fi

if ((remove_images==1)) || ((remove_all==1)); then
  compose_images="$(docker images --filter "reference=devpush*" -q 2>/dev/null || true)"
  runner_images="$(docker images --filter "reference=runner-*" -q 2>/dev/null || true)"
  images="$(printf "%s\n%s\n" "$compose_images" "$runner_images" | grep -v '^\s*$' | sort -u || true)"
  if [[ -n "$images" ]]; then
    run_cmd --try "Removing images..." docker rmi -f $images >/dev/null 2>&1 || true
  else
    printf "Removing images... ${YEL}⊘${NC}\n"
    printf "${DIM}${CHILD_MARK} No images found${NC}\n"
  fi
fi

# Success message
printf '\n'
printf "${GRN}Clean up complete. ✔${NC}\n"
