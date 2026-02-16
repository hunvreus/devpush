#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "stop"

usage(){
  cat <<USG
Usage: stop.sh [--components <csv>] [--hard] [-h|--help]

Stop the /dev/push stack (dev or prod auto-detected).

  --components <csv>
                    Comma-separated list of services to stop (${VALID_COMPONENTS//|/, })
  --hard             Force stop all containers labeled for the devpush project
  -h, --help         Show this help
USG
  exit 0
}

# Force stop all containers labeled for the devpush project
force_stop_all() {
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker is required for --hard"
    exit 1
  fi
  local containers_count
  local -a containers=()
  local containers_out=""
  local container_id=""
  if ! containers_out="$(docker ps --filter "label=com.docker.compose.project=devpush" -q 2>/dev/null)"; then
    err "Failed to query running containers for the devpush project."
    return 1
  fi
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    containers+=("$container_id")
  done <<<"$containers_out"
  containers_count="${#containers[@]}"
  printf '\n'
  if (( containers_count > 0 )); then
    if ! run_cmd --try "Stopping containers ($containers_count found)" docker stop "${containers[@]}"; then
      if ! docker ps --filter "label=com.docker.compose.project=devpush" >/dev/null 2>&1; then
        err "Unable to verify whether containers are stopped (docker ps failed)."
        return 1
      fi
      if ! is_stack_running; then
        return 0
      fi
      return 1
    fi
  else
    printf "Stopping containers (0 found) ${YEL}⊘${NC}\n"
  fi
}

# Parse CLI flags
hard_mode=0
comps=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --components)
      comps="$2"
      IFS=',' read -ra _sp_secs <<< "$comps"
      for comp in "${_sp_secs[@]}"; do
        comp="${comp// /}"
        [[ -z "$comp" ]] && continue
        if ! validate_component "$comp"; then
          exit 1
        fi
      done
      shift 2
      ;;
    --hard) hard_mode=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

if ((hard_mode==0)); then
  if [[ -z "$comps" ]]; then
    if ! is_stack_running; then
      printf '\n'
      printf "${DIM}No running services to stop.${NC}\n"
      exit 0
    fi
  fi
fi

service_running() {
  local service="$1"
  docker ps \
    --filter "label=com.docker.compose.project=devpush" \
    --filter "label=com.docker.compose.service=${service}" \
    -q \
    | grep -q .
}

selected_services=()
if [[ -n "$comps" ]]; then
  IFS=',' read -ra _selected_services <<< "$comps"
  for service in "${_selected_services[@]}"; do
    service="${service// /}"
    [[ -n "$service" ]] && selected_services+=("$service")
  done
fi

if ((hard_mode==1)); then
  if ((${#selected_services[@]} > 0)); then
    selected_ids=()
    for service in "${selected_services[@]}"; do
      while IFS= read -r cid; do
        [[ -n "$cid" ]] && selected_ids+=("$cid")
      done < <(
        docker ps \
          --filter "label=com.docker.compose.project=devpush" \
          --filter "label=com.docker.compose.service=${service}" \
          -q 2>/dev/null || true
      )
    done
    printf '\n'
    if ((${#selected_ids[@]} > 0)); then
      run_cmd "Stopping selected containers (${#selected_ids[@]} found)" docker stop "${selected_ids[@]}"
    else
      printf "Stopping selected containers (0 found) ${YEL}⊘${NC}\n"
    fi
  elif ! force_stop_all; then
    exit 1
  fi
else
  set_compose_base
  printf '\n'
  if ((${#selected_services[@]} > 0)); then
    if ! run_cmd --try "Stopping selected services..." "${COMPOSE_BASE[@]}" stop "${selected_services[@]}"; then
      printf '\n'
      err "Graceful stop failed for selected services."
      exit 1
    fi
  elif ! run_cmd --try "Stopping stack..." "${COMPOSE_BASE[@]}" stop; then
    printf '\n'
    err "Graceful stop failed; force-stopping containers."
    if ! force_stop_all; then
      exit 1
    fi
  fi
fi

# Verify stop outcome
if ! docker ps --filter "label=com.docker.compose.project=devpush" >/dev/null 2>&1; then
  printf '\n'
  err "Unable to verify whether containers are stopped (docker ps failed)."
  exit 1
fi
if ((${#selected_services[@]} > 0)); then
  running_selected=0
  for service in "${selected_services[@]}"; do
    if service_running "$service"; then
      running_selected=1
      break
    fi
  done
  if ((running_selected==1)); then
    printf '\n'
    err "Some selected services are still running."
    err "Try: scripts/stop.sh --components ${comps} --hard (or run with sudo)."
    exit 1
  fi
elif is_stack_running; then
  printf '\n'
  err "Stack still has running containers."
  err "Try: scripts/stop.sh --hard (or run with sudo)."
  exit 1
fi

# Success message
printf '\n'
printf "${GRN}Stack stopped. ✔${NC}\n"
