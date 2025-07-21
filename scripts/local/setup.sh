#!/bin/bash
set -e

echo "🚀 Setting up local development environment..."

# Always stop and restart Colima to ensure correct flags
echo "Stopping Colima..."
colima stop

echo "Starting Colima with K3s (Traefik disabled)..."
colima start --kubernetes --kubernetes-disable=traefik --cpu 4 --memory 8 --disk 50

# Install Traefik via kubectl
echo "Installing Traefik..."
kubectl apply -f k8s/traefik.yaml

echo "⏳ Waiting for Traefik to be ready..."
kubectl wait --for=condition=ready pod -l app=traefik -n ingress-traefik --timeout=120s

echo "✅ Environment setup complete!"
echo "💡 Run ./scripts/local/start.sh to deploy your application" 