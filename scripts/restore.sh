#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "restore"

usage(){
  cat <<USG
Usage: restore.sh --archive <file> [--no-db] [--no-data] [--no-code] [--no-restart] [--no-backup] [--timeout <sec>] [--yes] [-v|--verbose]

Restore a backup produced by scripts/backup.sh.

  --archive <file>   Backup archive to restore (required)
  --no-db            Skip restoring the pg_dump from the archive
  --no-data          Skip restoring the data directory
  --no-code          Skip restoring the code repository
  --no-restart       Skip restarting the stack after restore
  --no-backup        Skip creating a backup before restoring
  --remove-runners   Remove runner containers before restoring
  --no-rebuild-images
                     Skip rebuilding app/worker images after restore (default: rebuild)
  --timeout <sec>    Max seconds to wait for pgsql to be ready (default: 60)
  --yes              Skip confirmation prompts
  --keep-secret      Do not rotate SECRET_KEY after restore
  -v, --verbose      Enable verbose output
  -h, --help         Show this help
USG
  exit 0
}

# Wait for the pgsql container to be ready
wait_for_pgsql() {
  local user="$1"
  local max_attempts="$2"
  local sleep_seconds="${3:-5}"
  local timeout=$((max_attempts * sleep_seconds))
  local attempt=0

  while (( attempt < max_attempts )); do
    if "${COMPOSE_BASE[@]}" exec -T pgsql pg_isready -U "$user" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
    ((attempt+=1))
  done
  err "pgsql did not become ready within ${timeout}s. Inspect logs with: scripts/compose.sh logs pgsql"
  return 1
}

# Parse CLI flags
archive_path=""
restore_data=1
restore_db=1
restore_code=1
restart_stack=1
timeout=60
skip_backup=0
remove_runners=0
yes=0
rotate_secret=1
rebuild_images=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive) archive_path="$2"; shift 2 ;;
    --no-db) restore_db=0; shift ;;
    --no-data) restore_data=0; shift ;;
    --no-code) restore_code=0; shift ;;
    --no-restart) restart_stack=0; shift ;;
    --no-backup) skip_backup=1; shift ;;
    --remove-runners) remove_runners=1; shift ;;
    --no-rebuild-images) rebuild_images=0; shift ;;
    --timeout) timeout="$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    --keep-secret) rotate_secret=0; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

[[ -n "$archive_path" ]] || { err "--archive is required"; usage; }
[[ -f "$archive_path" ]] || { err "Archive not found: $archive_path"; exit 1; }

[[ "$ENVIRONMENT" == "production" && $EUID -ne 0 ]] && { err "This script must be run as root (sudo)."; exit 1; }

if (( restore_data == 0 && restore_db == 0 && restore_code == 0 )); then
  err "Nothing to do: both --no-data, --no-db and --no-code supplied."
  exit 1
fi

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

set_service_ids

# Create a temporary directory for the restore
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/devpush-restore.XXXXXX")"
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

printf '\n'
run_cmd "Unpacking archive" tar -xzf "$archive_path" -C "$stage_dir"

[[ -d "$stage_dir/data" ]] || { err "Archive missing data/ directory"; exit 1; }
[[ -f "$stage_dir/data/version.json" ]] || { err "Archive missing data/version.json"; exit 1; }
if (( restore_db == 1 )); then
  [[ -d "$stage_dir/db" ]] || { err "Archive missing db/ directory"; exit 1; }
  [[ -f "$stage_dir/db/pgdump.sql" ]] || { err "Archive missing db/pgdump.sql"; exit 1; }
fi


affected_resources=()
(( restore_data == 1 )) && affected_resources+=("data directory")
(( restore_db == 1 )) && affected_resources+=("PostgreSQL database")
(( restore_code == 1 )) && affected_resources+=("code repository")
IFS=', '; affected_list="${affected_resources[*]}"; unset IFS

printf '\n'
printf "${YEL}WARNING: This will stop the stack, replace data from your current stack ($affected_list) with the data from the backup and start the stack again. A safety backup of your current stack will be created before restoring.${NC}\n"

printf '\n'
printf "Restore from:\n"
printf "  - Archive: %s\n" "$archive_path"
if [[ -f "$stage_dir/metadata.json" ]]; then
  meta_created="$(json_get created_at "$stage_dir/metadata.json" "" || true)"
  meta_env="$(json_get environment "$stage_dir/metadata.json" "" || true)"
  meta_host_name="$(json_get host_name "$stage_dir/metadata.json" "" || true)"
  meta_host_ip="$(json_get host_ip "$stage_dir/metadata.json" "" || true)"
  [[ -n "$meta_created" ]] && printf "  - Created at: %s\n" "$meta_created"
  [[ -n "$meta_env" ]] && printf "  - Source environment: %s\n" "$meta_env"
  if [[ -n "$meta_host_name" || -n "$meta_host_ip" ]]; then
    host_display="${meta_host_name:-unknown}"
    [[ -n "$meta_host_ip" ]] && host_display="${host_display} ($meta_host_ip)"
    printf "  - Host: %s\n" "$host_display"
  fi
fi

if (( yes == 0 )); then
  printf '\n'
  read -r -p "Proceed with restore? [y/N]: " proceed_answer
  if [[ ! "$proceed_answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    printf "${YEL}Restore aborted by user.${NC}\n"
    exit 0
  fi
fi

# Create a safety backup before restoring
if (( skip_backup == 0 )); then
printf '\n'
  run_cmd "Creating backup before restore" bash "$SCRIPT_DIR/backup.sh"
  latest_backup="$(ls -t "$BACKUP_DIR"/devpush-*.tar.gz 2>/dev/null | head -n1 || true)"
  if [[ -n "$latest_backup" ]]; then
    printf "  ${DIM}${CHILD_MARK} Saved to: %s${NC}\n" "$latest_backup"
  fi
fi

# Stop the stack
printf '\n'
run_cmd "Stopping stack" bash "$SCRIPT_DIR/stop.sh"

# Restore data directory
if (( restore_data == 1 )); then
  printf '\n'
  printf "Restoring data directory\n"
  if [[ -d "$DATA_DIR" ]]; then
    run_cmd "${CHILD_MARK} Removing existing data dir" rm -rf "$DATA_DIR"
  fi
  mkdir -p -m 0750 "$DATA_DIR"
  run_cmd "${CHILD_MARK} Restoring data from backup" cp -a "$stage_dir/data/." "$DATA_DIR/"
  if [[ -n "${SERVICE_USER:-}" ]]; then
    chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" >/dev/null 2>&1 || true
  fi
  ensure_acme_json
fi

# Rotate SECRET_KEY unless opted out
if (( restore_data == 1 && rotate_secret == 1 )); then
  printf '\n'
  printf "Rotating SECRET_KEY\n"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "Cannot rotate SECRET_KEY: $ENV_FILE not found"
    exit 1
  fi
  run_cmd "${CHILD_MARK} Writing new SECRET_KEY to ${ENV_FILE}" bash -c '
    set -Eeuo pipefail
    env_file="$1"
    new_secret="$(openssl rand -hex 32)"
    if grep -q "^[[:space:]]*SECRET_KEY[[:space:]]*=" "$env_file"; then
      sed -i'' -e "s|^[[:space:]]*SECRET_KEY[[:space:]]*=.*|SECRET_KEY=\"${new_secret}\"|" "$env_file"
    else
      printf "\\nSECRET_KEY=\"%s\"\\n" "$new_secret" >> "$env_file"
    fi
    chmod 0600 "$env_file"
  ' rotate "$ENV_FILE"
  if [[ -n "${SERVICE_USER:-}" ]]; then
    chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE" >/dev/null 2>&1 || true
  fi
fi

# Remove runner containers if requested
if (( remove_runners == 1 )); then
  printf '\n'
  runner_containers="$(docker ps -a --filter "label=devpush.deployment_id" -q 2>/dev/null || true)"
  if [[ -n "$runner_containers" ]]; then
    count=$(printf '%s\n' "$runner_containers" | wc -l | tr -d ' ')
    run_cmd --try "Removing runner containers ($count found)" docker rm -f $runner_containers
  else
    printf "Removing runner containers (0 found) ${YEL}⊘${NC}\n"
  fi
fi

# Restore database
if (( restore_db == 1 )); then
  [[ -f "$ENV_FILE" ]] || { err "Cannot restore database without $ENV_FILE"; exit 1; }
  pg_db="$(read_env_value "$ENV_FILE" POSTGRES_DB)"
  pg_db="${pg_db:-devpush}"
  pg_user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
  pg_user="${pg_user:-devpush-app}"
  pg_password="$(read_env_value "$ENV_FILE" POSTGRES_PASSWORD)"
  [[ -n "$pg_password" ]] || { err "POSTGRES_PASSWORD missing in $ENV_FILE"; exit 1; }

  printf '\n'
  printf "Restoring database\n"
  set_compose_base
  run_cmd "${CHILD_MARK} Starting pgsql" "${COMPOSE_BASE[@]}" up -d pgsql
  pg_container="$(docker ps --filter "label=com.docker.compose.project=devpush" --filter "label=com.docker.compose.service=pgsql" --format '{{.ID}}' | head -n1 || true)"
  if [[ -z "$pg_container" ]]; then
    err "pgsql container did not start. Inspect logs with: scripts/compose.sh logs pgsql"
    exit 1
  fi

  step_sleep=5
  max_attempts=$(( (timeout + step_sleep - 1) / step_sleep ))
  (( max_attempts < 1 )) && max_attempts=1
  run_cmd "${CHILD_MARK} Waiting for database" wait_for_pgsql "$pg_user" "$max_attempts" "$step_sleep"

  export PG_RESET_PASS="$pg_password"
  run_cmd "${CHILD_MARK} Resetting database schema" bash -c '
    set -Eeuo pipefail
    env "PGPASSWORD=$PG_RESET_PASS" "$@" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  ' reset "${COMPOSE_BASE[@]}" exec -T pgsql psql -U "$pg_user" -d "$pg_db"

  export PG_RESTORE_FILE="$stage_dir/db/pgdump.sql" PG_RESTORE_PASS="$pg_password"
  run_cmd "${CHILD_MARK} Importing dump" bash -c '
    set -Eeuo pipefail
    cat "$PG_RESTORE_FILE" | env "PGPASSWORD=$PG_RESTORE_PASS" "$@" >/dev/null
  ' restore "${COMPOSE_BASE[@]}" exec -T pgsql psql -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db"
  unset PG_RESTORE_FILE PG_RESTORE_PASS PG_RESET_PASS
  run_cmd "${CHILD_MARK} Stopping pgsql" "${COMPOSE_BASE[@]}" stop pgsql
fi

# Restore code
if (( restore_code == 1 )); then
  version_file="$DATA_DIR/version.json"
  printf '\n'
  printf "Restoring code\n"
  
  restore_ref="$(json_get git_ref "$stage_dir/data/version.json" "" || true)"
  restore_commit="$(json_get git_commit "$stage_dir/data/version.json" "" || true)"

  [[ -n "$restore_commit" ]] || { err "No git commit recorded in backup metadata"; exit 1; }
  [[ -d "$APP_DIR/.git" ]] || { err "Git repo not found at $APP_DIR"; exit 1; }
  
  git_cmd=(git -C "$APP_DIR")
  if [[ "$(id -un)" != "$SERVICE_USER" ]]; then
    git_cmd=(runuser -u "$SERVICE_USER" -- git -C "$APP_DIR")
  fi
  current_commit="$("${git_cmd[@]}" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$current_commit" == "$restore_commit" ]]; then
    printf "  ${DIM}${CHILD_MARK} Skipping: Repository already at commit %s${NC}\n" "$restore_commit"
  else
    display_target="$restore_commit"
    [[ -n "$restore_ref" ]] && display_target="$display_target (recorded as $restore_ref)"
    if ! run_cmd --try "${CHILD_MARK} Checking out commit ${restore_commit} locally" "${git_cmd[@]}" checkout -f "$restore_commit"; then
      remote_name="$("${git_cmd[@]}" remote 2>/dev/null | head -n1 || true)"
      if [[ -n "$remote_name" && -n "$restore_ref" ]]; then
        run_cmd "${CHILD_MARK} Fetching ${restore_ref} from ${remote_name}" "${git_cmd[@]}" fetch "$remote_name" "$restore_ref"
        if ! run_cmd --try "${CHILD_MARK} Checking out commit ${restore_commit}" "${git_cmd[@]}" checkout -f "$restore_commit"; then
          err "Failed to checkout commit ${restore_commit} after fetching ${restore_ref}. The commit may not be on that ref, or may not exist in the remote repository."
          exit 1
        fi
      elif [[ -z "$remote_name" ]]; then
        err "Failed to checkout commit ${restore_commit} (not found locally) and no remote is configured to fetch from."
        exit 1
      else
        err "Failed to checkout commit ${restore_commit} (not found locally) and no ref was recorded in the backup to fetch from."
        exit 1
      fi
    fi
  fi
fi

# Optionally rebuild images (app + workers) after restore
if (( rebuild_images == 1 )); then
  printf '\n'
  set_compose_base
  run_cmd "Rebuilding app/worker images" "${COMPOSE_BASE[@]}" build app worker-arq worker-monitor
fi

# Start the stack
if (( restart_stack == 1 )); then
  printf '\n'
  run_cmd "Starting stack" bash "$SCRIPT_DIR/start.sh"
else
  start_cmd="scripts/start.sh"
  if [[ "$ENVIRONMENT" == "production" ]]; then
    start_cmd="systemctl start devpush.service"
  fi
  printf '\n'
  printf "${YEL}Skipping stack restart (--no-restart). Start the stack manually with: $start_cmd${NC}\n"
fi

# Success message
printf '\n'
printf "${GRN}Restore complete. ✔${NC}\n"
