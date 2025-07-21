#!/bin/bash

echo "🐚 Opening shell to app container..."

# Get app pod name
APP_POD=$(kubectl get pods -l io.kompose.service=app -o jsonpath='{.items[0].metadata.name}')

# Open shell
kubectl exec -it "$APP_POD" -- bash 