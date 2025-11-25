#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_ERR_LOG="/tmp/provision_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 's=$?; err "Provision failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage(){
  cat <<USG
Usage: provision/hetzner.sh [--token <token>] [--user <login_user>] [--name <hostname>] [--region <reg>] [--type <name>]

Provision a Hetzner Cloud server and create an SSH-enabled sudo user.

  --token TOKEN   Hetzner API token (optional; will prompt securely if not provided)
  --user NAME     Login username to create (optional; defaults to current shell user; must not be 'root')
  --name HOST     Server name/hostname (optional; defaults to devpush-<region>)
  --region LOC    Region (optional; defaults to 'hil'). Available:
                  fsn1 (Falkenstein, DE)
                  nbg1 (Nuremberg, DE)
                  hel1 (Helsinki, FI)
                  ash (Ashburn, VA, US)
                  hil (Hillsboro, OR, US)
                  sin (Singapore, SG)
  --type NAME     Server type (optional; defaults to 'cpx31'). Available:
                  cpx11 (2 vCPU, 2GB RAM, 20GB SSD)
                  cpx21 (3 vCPU, 4GB RAM, 40GB SSD)
                  cpx31 (2 vCPU, 4GB RAM, 80GB SSD)
                  cpx41 (4 vCPU, 8GB RAM, 160GB SSD)
                  cpx51 (8 vCPU, 16GB RAM, 240GB SSD)

  -h, --help      Show this help
USG
  exit 1
}

# Parse CLI flags
token=""; login_user_flag=""; name_flag=""; region_flag=""; type_flag=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) token="$2"; shift 2 ;;
    --user) login_user_flag="$2"; shift 2 ;;
    --name) name_flag="$2"; shift 2 ;;
    --region) region_flag="$2"; shift 2 ;;
    --type) type_flag="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

# Prompt for token if not provided
if [[ -z "$token" ]]; then
  if [[ -t 0 ]]; then
    printf "Hetzner API token: "
    read -s token
    printf '\n'
    [[ -n "$token" ]] || { err "Token cannot be empty"; exit 1; }
  else
    err "Missing --token (required in non-interactive mode)"
    usage
  fi
fi

# Check dependencies
command -v curl >/dev/null 2>&1 || { err "curl is required."; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq is required. Install with: brew install jq"; exit 1; }

# API helper functions
api_get() {
    curl -sS -H "Authorization: Bearer $token" "https://api.hetzner.cloud/v1/$1"
}

api_post() {
    curl -sS -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$2" "https://api.hetzner.cloud/v1/$1"
}

# Set defaults
region="${region_flag:-hil}"
server_type="${type_flag:-cpx31}"
server_name="${name_flag:-devpush-$region}"
login_user="${login_user_flag:-${USER:-admin}}"

if [[ "$login_user" == "root" ]]; then
    err "Refusing to create 'root'. Choose a non-root username."
    exit 1
fi

# Prepare provisioning
printf '\n'
printf "Preparing provisioning...\n"

run_cmd "${CHILD_MARK} Validating API token..." bash -c 'curl -sS -H "Authorization: Bearer '"$token"'" "https://api.hetzner.cloud/v1/ssh_keys" >/dev/null 2>&1 || { printf "Hetzner API token seems invalid or unauthorized. Visit https://console.hetzner.cloud/ to create a token.\n" >&2; exit 1; }'

printf "${CHILD_MARK} Fetching SSH keys...\n"
ssh_json=$(api_get ssh_keys)
ssh_count=$(printf '%s\n' "$ssh_json" | jq '.ssh_keys | length')
if [ "$ssh_count" -eq 0 ]; then
    err "No SSH keys found in your Hetzner project."
    printf "Add an SSH key in the Hetzner Cloud Console (Security → SSH Keys): https://console.hetzner.cloud/\n"
    printf "Then re-run this script.\n"
    exit 1
fi
printf "${GRN}✔${NC}\n"

ssh_ids=$(printf '%s\n' "$ssh_json" | jq '[.ssh_keys[].id]')
ssh_pub_lines=$(printf '%s\n' "$ssh_json" | jq -r '.ssh_keys[].public_key' | sed 's/^/      - /')

user_data=$(cat <<EOF
#cloud-config
users:
  - name: $login_user
    groups: sudo
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
$ssh_pub_lines
ssh_pwauth: false
disable_root: true
package_update: true
package_upgrade: true
EOF
)

payload=$(jq -n \
    --arg name "$server_name" \
    --arg st "$server_type" \
    --arg img "ubuntu-24.04" \
    --arg loc "$region" \
    --arg user_data "$user_data" \
    --argjson ssh_keys "$ssh_ids" \
    '{name:$name, server_type:$st, image:$img, location:$loc, ssh_keys:$ssh_keys, user_data:$user_data, start_after_create:true}')

# Create server
printf '\n'
printf "Creating server...\n"

printf "${CHILD_MARK} Creating server via API...\n"
create_resp=$(api_post servers "$payload")
server_id=$(printf '%s\n' "$create_resp" | jq -r '.server.id // empty')
if [ -z "$server_id" ]; then
    err "Failed to create server. Response below:"
    printf "%s\n" "$create_resp"
    exit 1
fi
printf "${GRN}✔${NC}\n"

run_cmd "${CHILD_MARK} Waiting for server to be ready..." bash -c '
  for i in $(seq 1 60); do
    status_json=$(curl -sS -H "Authorization: Bearer '"$token"'" "https://api.hetzner.cloud/v1/servers/'"$server_id"'")
    status=$(printf "%s\n" "$status_json" | jq -r ".server.status")
    if [ "$status" = "running" ]; then
      exit 0
    fi
    sleep 2
  done
  printf "Server did not become ready within 120 seconds\n" >&2
  exit 1
'

server_json=$(api_get servers/$server_id)
server_ip=$(printf '%s\n' "$server_json" | jq -r '.server.public_net.ipv4.ip')

# Success message
printf '\n'
printf "${GRN}Server successfully created! ✔${NC}\n"
printf "${DIM}Server name: $server_name${NC}\n"
printf "${DIM}Server IP: $server_ip${NC}\n"

# Next steps
printf '\n'
printf "Next steps:\n"
printf -- "- SSH in: ssh %s@%s\n" "$login_user" "$server_ip"
printf -- "- Install /dev/push: curl -fsSL https://raw.githubusercontent.com/hunvreus/devpush/main/scripts/install.sh | sudo bash\n"
printf -- "- Optional: harden system: curl -fsSL https://raw.githubusercontent.com/hunvreus/devpush/main/scripts/harden.sh | sudo bash -s -- --ssh\n"
