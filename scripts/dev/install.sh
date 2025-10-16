#!/bin/bash
set -e

usage(){
  cat <<USG
Usage: install.sh [-h|--help]

Sets up Colima for Docker on macOS and installs the Loki Docker logging plugin.

  -h, --help Show this help
USG
  exit 0
}
[[ "$1" == "-h" || "$1" == "--help" ]] && usage

echo "Checking Colima installation..."

# Check if colima is installed
if ! command -v colima &> /dev/null; then
    echo "Colima not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install colima
    else
        echo "Homebrew not found. Install Homebrew first: https://brew.sh"
        exit 1
    fi
else
    echo "Colima is already installed."
fi

# Ensure Colima is running
if ! colima status >/dev/null 2>&1; then
    echo "Starting Colima..."
    colima start --memory=4 --cpu=2 --disk=100
fi

# Ensure Docker CLI talks to Colima
if command -v docker >/dev/null 2>&1 && command -v docker context >/dev/null 2>&1; then
  docker context use colima >/dev/null 2>&1 || true
fi

# Light checks
if ! command -v docker >/dev/null 2>&1; then
  echo "Warning: docker CLI not found in PATH. Ensure Docker is installed or Colima configured."
fi
if ! command -v docker-compose >/dev/null 2>&1; then
  echo "Warning: docker-compose not found. Install it with Homebrew: brew install docker-compose"
fi

# Ensure Loki Docker logging plugin is installed (best-effort)
if docker plugin ls >/dev/null 2>&1; then
  if docker plugin inspect loki >/dev/null 2>&1; then
      echo "Loki Docker plugin is already installed."
  else
      echo "Installing Loki Docker plugin..."
      if docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions >/dev/null 2>&1; then
        echo "Loki Docker plugin installed."
      else
        echo "Warning: Loki plugin install failed; continuing without it."
      fi
  fi
else
  echo "Warning: This Docker engine doesn't support plugins (or not available via CLI); skipping Loki plugin."
fi

echo "Colima + Loki setup complete."