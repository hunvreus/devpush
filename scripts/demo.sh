#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'printf "Demo failed near: %s\n" "${BASH_COMMAND}" >&2' ERR

# Intro
printf "Run Helpers Demo\n"
printf "This script demonstrates run_cmd and run_cmd_stream.\n"
printf '\n'

# Basic messages
printf "Messages\n"
printf "%s This is a step line.\n" "$CHILD_MARK"
printf "This is an info line.\n"
printf "${CLR_YELLOW}This is a warning line.${CLR_RESET}\n"
printf "${CLR_GREEN}This is a success line.${CLR_RESET}\n"
printf '\n'

# Spinner examples
printf "Spinner\n"
run_cmd "Simulating successful work (2s)..." sleep 2

if ! run_cmd "Simulating failed work (1s)..." sh -lc 'sleep 1; exit 1'; then
  printf "${CLR_YELLOW}Failure path captured as expected.${CLR_RESET}\n"
fi
printf '\n'

# Streaming example
printf "Streaming\n"
run_cmd_stream "Streaming command output (1s)..." sh -lc 'echo "line 1"; sleep 1; echo "line 2"'
