#!/bin/bash

echo "Cleaning up local environment..."

# Stop Colima (this stops K3s and Docker)
echo "Stopping Colima..."
colima stop

# Clean up Docker images
echo "Cleaning Docker images..."
docker image prune -f

# Clean up data directories
echo "Cleaning data directories..."
rm -rf ./data/traefik/* ./data/upload/* || true
mkdir -p ./data/{traefik,upload}

echo "✅ Local environment cleaned!"
echo "💡 Run ./scripts/local/setup.sh to start fresh"