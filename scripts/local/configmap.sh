#!/bin/bash
set -e

echo "🔄 Updating ConfigMap from .env file..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Create/update ConfigMap from .env file (strip quotes)
kubectl create configmap env --from-env-file=.env --dry-run=client -o yaml | \
  sed 's/"\([^"]*\)"/\1/g' | kubectl apply -f -

echo "✅ ConfigMap updated from .env file!" 