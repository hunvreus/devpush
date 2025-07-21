#!/usr/bin/env sh
# Run database migrations

set -e

echo "Running database migrations..."

# Get app pod name
APP_POD=$(kubectl get pods -l io.kompose.service=app -o jsonpath='{.items[0].metadata.name}')

# Run migrations
kubectl exec "$APP_POD" -- uv run alembic upgrade head

echo "✅ Migrations complete!" 