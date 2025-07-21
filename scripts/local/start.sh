#!/bin/bash

echo "🚀 Starting development environment..."

# Check if Colima is running
if ! colima status > /dev/null 2>&1; then
    echo "❌ Colima not running. Run ./scripts/local/setup.sh first."
    exit 1
fi

# Check if Traefik is installed
if ! kubectl get pods -n ingress-traefik | grep -q traefik; then
    echo "❌ Traefik not found. Run ./scripts/local/setup.sh first."
    exit 1
fi

# Update ConfigMap and deploy
echo "📦 Building and deploying application..."
./scripts/local/deploy.sh

echo "✅ Development environment ready!"
echo "🌐 App available at: http://localhost:30080"