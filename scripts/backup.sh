#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

init_script_logging "backup"

usage(){
  cat <<USG
Usage: backup.sh [--output <file>] [-v|--verbose] [-h|--help]

Create a backup containing a full copy of \$DATA_DIR and a pg_dump from pgsql.

  --output <file>     Path for the resulting tar.gz (default: ${BACKUP_DIR}/devpush-<timestamp>.tar.gz)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help
USG
  exit 0
}

# Parse CLI flags
output_path=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output_path="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

[[ "$ENVIRONMENT" == "production" && $EUID -ne 0 ]] && { err "This script must be run as root (sudo)."; exit 1; }

[[ -f "$ENV_FILE" ]] || { err "Environment file not found: $ENV_FILE"; exit 1; }

[[ -d "$DATA_DIR" ]] || { err "Data dir not found: $DATA_DIR"; exit 1; }

cd "$APP_DIR" || { err "App dir not found: $APP_DIR"; exit 1; }

docker info >/dev/null 2>&1 || { err "Docker not accessible. Run with sudo or add your user to the docker group."; exit 1; }

# Resolve output target
timestamp="$(date +%Y%m%d-%H%M%S)"
if [[ -z "$output_path" ]]; then
  mkdir -p -m 0750 "$BACKUP_DIR"
  output_path="$BACKUP_DIR/devpush-${timestamp}.tar.gz"
else
  mkdir -p "$(dirname "$output_path")"
fi

# Prepare workspace
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/devpush-backup.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

set_compose_base

# Stage data directory
mkdir -p -m 0750 "$tmp_dir/data"
printf '\n'
run_cmd "Saving data directory..." bash -c '
  set -Eeuo pipefail
  src="$1"; dest="$2"
  tar -C "$src" -cf - . | tar -C "$dest" -xf -
' copy "$DATA_DIR" "$tmp_dir/data"

# Capture database dump
pg_db="$(read_env_value "$ENV_FILE" POSTGRES_DB)"
pg_db="${pg_db:-devpush}"
pg_user="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
pg_user="${pg_user:-devpush-app}"
pg_password="$(read_env_value "$ENV_FILE" POSTGRES_PASSWORD)"
[[ -n "$pg_password" ]] || { err "POSTGRES_PASSWORD missing in $ENV_FILE"; exit 1; }

pg_container="$(docker ps --filter "label=com.docker.compose.project=devpush" --filter "label=com.docker.compose.service=pgsql" --format '{{.ID}}' | head -n1 || true)"
[[ -n "$pg_container" ]] || { err "pgsql container is not running; start the stack before running backup."; exit 1; }

mkdir -p -m 0750 "$tmp_dir/db"
db_dump_path="$tmp_dir/db/pgdump.sql"

export PG_DUMP_FILE="$db_dump_path" PG_DUMP_PASS="$pg_password"

printf '\n'
run_cmd "Creating database dump..." bash -c '
  set -Eeuo pipefail
  env "PGPASSWORD=$PG_DUMP_PASS" "$@" >"$PG_DUMP_FILE"
' pgdump "${COMPOSE_BASE[@]}" exec -T pgsql pg_dump -U "$pg_user" -d "$pg_db" --no-owner --no-privileges
unset PG_DUMP_FILE PG_DUMP_PASS

# Persist metadata
host_name="$(hostname 2>/dev/null || printf 'unknown')"
host_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || printf '')"
if [[ -z "$host_ip" ]]; then
  host_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || printf '')"
fi

cat >"$tmp_dir/metadata.json" <<JSON
{
  "created_at": "$(date -Iseconds)",
  "environment": "$ENVIRONMENT",
  "data_dir": "$DATA_DIR",
  "app_dir": "$APP_DIR",
  "host_name": "$host_name",
  "host_ip": "$host_ip",
  "archive_path": "$output_path"
}
JSON

# Create a tag.gz of the backup files (data dir, db dump, metadata)
printf '\n'
printf "Creating archive...\n"
run_cmd "${CHILD_MARK} Packing files..." tar -czf "$output_path" -C "$tmp_dir" data db metadata.json
chmod 0640 "$output_path" >/dev/null 2>&1 || true
run_cmd "${CHILD_MARK} Verifying archive..." bash -c '
  set -Eeuo pipefail
  tar -tzf "$1" >/dev/null
' verify "$output_path"

# Getting the size of the backup file
size_display="$(du -h "$output_path" 2>/dev/null | awk 'NR==1 {print $1}')"
[[ -n "$size_display" ]] || size_display="$(stat -f'%z' "$output_path" 2>/dev/null || printf 'unknown')"

printf '\n'
printf "${GRN}Backup complete. ✔${NC}\n"
printf "${DIM}Saved to: %s (%s)${NC}\n" "$output_path" "$size_display"
