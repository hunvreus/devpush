#!/bin/bash
set -e

echo "🚀 Deploying to local Kubernetes..."

# Get repo root and fix path in deployment
REPO_ROOT=$(pwd)
echo "📍 Repo root: $REPO_ROOT"

# Create/update ConfigMap from .env
echo "🔄 Creating/updating ConfigMap from .env..."
./scripts/local/configmap.sh

# Build images
echo "📦 Building Docker images..."
docker build -f Docker/Dockerfile.app -t app:latest .

# Deploy in dependency order
echo "🗄️  Deploying database..."
kubectl apply -f k8s/db-persistentvolumeclaim.yaml
kubectl apply -f k8s/pgsql.yaml

echo "🔴 Deploying Redis..."
kubectl apply -f k8s/redis.yaml

echo "⚙️  Deploying app..."
REPO_ROOT=$REPO_ROOT envsubst < k8s/app.yaml | kubectl apply -f -

echo "🌐 Deploying ingress..."
kubectl apply -f k8s/app-ingress.yaml

echo "⏳ Waiting for services to be ready..."
kubectl wait --for=condition=ready pod -l io.kompose.service=pgsql --timeout=60s
kubectl wait --for=condition=ready pod -l io.kompose.service=redis --timeout=60s
kubectl wait --for=condition=ready pod -l io.kompose.service=app --timeout=60s

echo "✅ Deployment complete!"
echo "🌐 App available at: http://localhost:30080" 