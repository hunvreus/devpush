#!/bin/bash
set -e

usage(){
  cat <<USG
Usage: db-generate.sh [-h|--help]

Generate an Alembic migration from model changes.

  -h, --help  Show this help
USG
  exit 0
}
[ "$1" = "-h" ] || [ "$1" = "--help" ] && usage

command -v docker-compose >/dev/null 2>&1 || { echo "docker-compose not found"; exit 1; }
args=(-p devpush -f compose/base.yml -f compose/override.dev.yml)
env_flag=()
[[ -f ./data/.env ]] && env_flag=(--env-file ./data/.env)

echo "Creating database migrations..."

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

echo "Database is ready. Creating migrations..."

# Prompt user for migration message
read -p "Migration message: " message

# Check if message was provided
if [ -z "$message" ]; then
    echo "Error: Migration message is required"
    exit 1
fi

# Generate the migration
docker-compose "${env_flag[@]}" "${args[@]}" exec app uv run alembic revision --autogenerate -m "$message"

echo "Migrations created successfully!" 
