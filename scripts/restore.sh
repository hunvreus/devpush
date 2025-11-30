#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib.sh"

init_script_logging "restore"

usage(){
  cat <<USG
Usage: restore.sh --archive <file> [--no-db] [--no-data] [--restart] [--yes] [-v|--verbose]

Restore a backup produced by scripts/backup.sh.

  --archive <file>   Backup archive to restore (required)
  --no-db            Skip restoring the pg_dump from the archive
  --no-data          Skip restoring the data directory
  --restart          Restart the stack after restore
  --yes              Skip confirmation prompts (except backup warning)
  -v, --verbose      Enable verbose output
  -h, --help         Show this help
USG
  exit 0
}

# Backup existing path
backup_existing_path() {
  local target="$1"
  local label="$2"
  local stamp="$3"
  if [[ -e "$target" || -L "$target" ]]; then
    local backup="${target}.pre-restore-${stamp}"
    local counter=1
    while [[ -e "$backup" || -L "$backup" ]]; do
      backup="${target}.pre-restore-${stamp}-${counter}"
      ((counter+=1))
    done
    mv "$target" "$backup"
    printf "  ${DIM}${CHILD_MARK} Existing %s moved to %s${NC}\n" "$label" "$backup"
  fi
}

# Parse CLI flags
archive_path=""
restore_data=1
restore_db=1
restart_stack=0
assume_yes=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive) archive_path="$2"; shift 2 ;;
    --no-db) restore_db=0; shift ;;
    --no-data) restore_data=0; shift ;;
    --restart) restart_stack=1; shift ;;
    --yes) assume_yes=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

[[ -n "$archive_path" ]] || { err "--archive is required"; usage; }
[[ -f "$archive_path" ]] || { err "Archive not found: $archive_path"; exit 1; }
[[ "$ENVIRONMENT" == "production" && $EUID -ne 0 ]] && { err "Run restore.sh as root (sudo)."; exit 1; }
if (( restore_data == 0 && restore_db == 0 )); then
  err "Nothing to do: both --no-data and --no-db supplied."
  exit 1
fi
cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/devpush-restore.XXXXXX")"
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

printf '\n'
printf "Unpacking archive...\n"
run_cmd "${CHILD_MARK} Extracting..." tar -xzf "$archive_path" -C "$stage_dir"

stage_data="$stage_dir/data"
stage_db_dir="$stage_dir/db"
metadata_path="$stage_dir/metadata.json"
[[ -d "$stage_data" ]] || { err "Archive missing data/ directory"; exit 1; }
embedded_dump="$stage_db_dir/pgdump.sql"

timestamp="$(date +%Y%m%d-%H%M%S)"
ssl_provider="default"
if [[ "$ENVIRONMENT" == "production" ]]; then
  ssl_provider="$(get_ssl_provider 2>/dev/null || echo "default")"
fi

printf '\n'
printf "Restore plan:\n"
printf "  - Archive: %s\n" "$archive_path"
if [[ -f "$metadata_path" ]]; then
  meta_created="$(json_get created_at "$metadata_path" "" || true)"
  meta_env="$(json_get environment "$metadata_path" "" || true)"
  meta_host="$(json_get host "$metadata_path" "" || true)"
  [[ -n "$meta_created" ]] && printf "  - Created at: %s\n" "$meta_created"
  [[ -n "$meta_env" ]] && printf "  - Source environment: %s\n" "$meta_env"
  [[ -n "$meta_host" ]] && printf "  - Source host: %s\n" "$meta_host"
fi
if (( restore_data == 1 )); then
  printf "  - Data: restore into %s\n" "$DATA_DIR"
else
  printf "  - Data: skipped (--no-data)\n"
fi
if (( restore_db == 1 )); then
  printf "  - Database: restore from embedded dump\n"
else
  printf "  - Database: skipped (--no-db)\n"
fi
if (( restart_stack == 1 )); then
  printf "  - Restart stack: yes\n"
else
  printf "  - Restart stack: no (use --restart to enable)\n"
fi

if (( assume_yes == 0 )); then
  printf '\n'
  read -r -p "Proceed with restore? [y/N]: " answer
  if [[ ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    printf "${YEL}Restore aborted by user.${NC}\n"
    exit 0
  fi
fi

backup_first=0
if (( assume_yes == 0 )); then
  read -r -p "Capture a backup before restoring? [y/N]: " backup_answer
  if [[ "$backup_answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
    backup_first=1
  fi
fi

if (( backup_first == 1 )); then
  printf '\n'
  printf "Running backup before restore...\n"
  run_cmd "${CHILD_MARK} Capturing backup..." bash "$SCRIPT_DIR/backup.sh"
fi

printf '\n'
printf "Ensuring stack is stopped...\n"
bash "$SCRIPT_DIR/../stop.sh"

# Restore DATA_DIR
if (( restore_data == 1 )); then
  printf '\n'
  printf "Restoring data directory...\n"
  mkdir -p "$(dirname "$DATA_DIR")"
  backup_existing_path "$DATA_DIR" "$DATA_DIR" "$timestamp"
  install -d -m 0750 "$DATA_DIR"
  run_cmd "${CHILD_MARK} Copying data..." bash -c '
    set -Eeuo pipefail
    src="$1"; dest="$2"
    tar -C "$src" -cf - . | tar -C "$dest" -xf -
  ' copy "$stage_data" "$DATA_DIR"
  ensure_acme_json
else
  printf '\n'
  printf "${DIM}Skipping data restore (--no-data).${NC}\n"
fi

# Restore database when requested
if (( restore_db == 1 )); then
  [[ -f "$ENV_FILE" ]] || { err "Cannot restore database without $ENV_FILE"; exit 1; }
  pg_db="$(read_env_value "$ENV_FILE" POSTGRES_DB)"
  pg_db="${pg_db:-devpush}"
  pg_user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
  pg_user="${pg_user:-devpush-app}"
  pg_password="$(read_env_value "$ENV_FILE" POSTGRES_PASSWORD)"
  [[ -n "$pg_password" ]] || { err "POSTGRES_PASSWORD missing in $ENV_FILE"; exit 1; }

  db_source="$embedded_dump"
  if [[ ! -f "$db_source" ]]; then
    err "Archive missing db/pgdump.sql and no --no-db flag supplied."
    exit 1
  fi

  printf '\n'
  printf "Restoring database...\n"
  set_compose_base run "$ssl_provider"
  run_cmd "${CHILD_MARK} Starting pgsql..." "${COMPOSE_BASE[@]}" up -d pgsql

  pg_container="$(docker ps --filter "label=com.docker.compose.project=devpush" --filter "label=com.docker.compose.service=pgsql" --format '{{.ID}}' | head -n1 || true)"
  if [[ -z "$pg_container" ]]; then
    err "pgsql container did not start. Inspect logs with: scripts/compose.sh logs pgsql"
    exit 1
  fi

  export PG_RESTORE_FILE="$db_source" PG_RESTORE_PASS="$pg_password"
  run_cmd "${CHILD_MARK} Importing dump..." bash -c '
    set -Eeuo pipefail
    cat "$PG_RESTORE_FILE" | env "PGPASSWORD=$PG_RESTORE_PASS" "$@" >/dev/null
  ' restore "${COMPOSE_BASE[@]}" exec -T pgsql psql -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db"
  unset PG_RESTORE_FILE PG_RESTORE_PASS
  run_cmd "${CHILD_MARK} Stopping pgsql..." "${COMPOSE_BASE[@]}" stop pgsql
else
  printf '\n'
  printf "${DIM}Skipping database restore (--no-db).${NC}\n"
fi

if (( restart_stack == 1 )); then
  printf '\n'
  printf "Starting stack...\n"
  bash "$SCRIPT_DIR/../start.sh"
else
  printf '\n'
  printf "${DIM}Skipping stack restart (use --restart to enable).${NC}\n"
fi

printf '\n'
printf "${GRN}Restore complete. ✔${NC}\n"
printf "Next steps:\n"
printf "  - Verify application access\n"
printf "  - Confirm deployments reconcile\n"
