#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "k8s-down failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Validate prerequisites
require_cmd colima

printf "# Stop Kubernetes (Colima)\n"
run_cmd "Stopping Colima..." colima stop
printf '\n'
printf "${CLR_GREEN}Kubernetes stopped.${CLR_RESET}\n"
