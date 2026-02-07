#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib.sh"

init_script_logging "upgrade-0.4.5"

if [[ -d "$DATA_DIR/traefik" ]]; then
  printf '\n'
  run_cmd "${CHILD_MARK} Cleaning empty Traefik alias files" \
    bash -c '
      removed=0
      expected="$(printf "http:\nrouters: {}")"
      while IFS= read -r -d "" file; do
        content="$(awk "NF {gsub(/^[[:space:]]+/, \"\", \$0); print}" "$file")"
        if [[ "$content" == "$expected" ]]; then
          rm -f "$file"
          removed=$((removed + 1))
        fi
      done < <(find "$TRAEFIK_DIR" -type f -name "project_*.yml" -print0)
      printf "Removed %s empty file(s).\n" "$removed"
    ' TRAEFIK_DIR="$DATA_DIR/traefik"
fi
