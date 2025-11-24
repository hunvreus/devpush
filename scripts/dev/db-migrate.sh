#!/bin/bash
set -e

# Capture stderr for error reporting
exec 2> >(tee /tmp/db-migrate_error.log >&2)

usage(){
  cat <<USG
Usage: db-migrate.sh [-h|--help]

Apply Alembic migrations to the running dev database.

  -h, --help  Show this help
USG
  exit 0
}
[ "$1" = "-h" ] || [ "$1" = "--help" ] && usage

command -v docker-compose >/dev/null 2>&1 || { echo "docker-compose not found"; echo "Error details:"; cat /tmp/db-migrate_error.log 2>/dev/null || echo "No error details captured"; exit 1; }
args=(-p devpush -f compose/base.yml -f compose/override.dev.yml)
env_flag=()
[[ -f ./data/.env ]] && env_flag=(--env-file ./data/.env)

echo "Running database migrations..."

# Check if containers are running
if ! docker-compose "${env_flag[@]}" "${args[@]}" ps app | grep -q "Up"; then
    echo "Error: App container is not running. Start the environment first with ./scripts/dev/start.sh"
    exit 1
fi

# Check if database is ready
echo "Checking database connection..."
until docker-compose "${env_flag[@]}" "${args[@]}" exec pgsql pg_isready -U devpush-app; do
    echo "Database not ready yet..."
    sleep 2
done

echo "Database is ready. Running migrations..."
docker-compose "${env_flag[@]}" "${args[@]}" exec app uv run alembic upgrade head

echo "Migrations completed successfully!" 
