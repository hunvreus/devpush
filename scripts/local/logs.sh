#!/bin/bash

echo "📋 Showing app logs..."

# Get app pod name
APP_POD=$(kubectl get pods -l io.kompose.service=app -o jsonpath='{.items[0].metadata.name}')

# Show logs with follow
kubectl logs -f "$APP_POD" 