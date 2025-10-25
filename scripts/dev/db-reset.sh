#!/bin/sh
set -e

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  cat <<USG
Usage: db-reset.sh [-h|--help]

Drops and recreates the 'public' schema of the Postgres DB defined in .env

  -h, --help             Show this help
USG
  exit 0
fi

command -v docker-compose >/dev/null 2>&1 || { echo "docker-compose not found"; exit 1; }
args="-p devpush -f docker-compose.yml -f docker-compose.override.dev.yml"

[ -f .env ] && . ./.env
container=${DB_CONTAINER:-pgsql}
db_user=${POSTGRES_USER:-devpush}
db_name=${POSTGRES_DB:-devpush}

echo "Warning: This will DROP and recreate schema 'public' in database '$db_name'."
printf "Proceed? [y/N]: "
read ans
case "$ans" in
  y|Y|yes|YES) : ;;
  *) echo "Aborted."; exit 1;;
esac

docker-compose $args exec "$container" psql -U "$db_user" -d "$db_name" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
echo "Database schema reset."