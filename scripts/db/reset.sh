#!/usr/bin/env sh
# Drop and recreate the public schema of the Postgres DB

set -e

# Load environment variables
if [ -f .env ]; then
    source .env
fi

echo "Dropping and recreating the public schema of the Postgres DB"

# Get PostgreSQL pod name
PG_POD=$(kubectl get pods -l io.kompose.service=pgsql -o jsonpath='{.items[0].metadata.name}')

# Execute SQL command
kubectl exec "$PG_POD" -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Running database migrations to recreate tables..."

# Get app pod name
APP_POD=$(kubectl get pods -l io.kompose.service=app -o jsonpath='{.items[0].metadata.name}')

# Run migrations
kubectl exec "$APP_POD" -- uv run alembic upgrade head

echo "✅ Database reset complete!"