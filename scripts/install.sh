#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Require root early for consistent permissions
[[ $EUID -eq 0 ]] || { printf "install.sh must be run as root (sudo).\n" >&2; exit 1; }

SCRIPT_ERR_LOG="/tmp/install_error.log"
exec 2> >(tee "$SCRIPT_ERR_LOG" >&2)

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [[ -z "$SCRIPT_PATH" || "$SCRIPT_PATH" == "-" ]]; then
  # Piped execution
  SCRIPT_DIR="$(pwd)"
else
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
fi

# Resolve desired git ref (flag wins; otherwise auto-detect latest release tag)
ref=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  arg="${args[i]}"
  next="${args[i+1]:-}"
  if [[ "$arg" == "--ref" && -n "$next" ]]; then
    ref="$next"
    ((i+=1))
  fi
done

if [[ -z "$ref" ]]; then
  repo="https://github.com/hunvreus/devpush.git"
  if ! refs_output="$(git ls-remote --tags --refs "$repo" 2>&1)"; then
    printf "Error: git ls-remote failed while resolving latest release (output below)\n%s\n" "$refs_output"
    exit 1
  fi
  ref="$(printf "%s\n" "$refs_output" | awk -F/ '{print $3}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
  if [[ -z "$ref" ]]; then
    ref="$(printf "%s\n" "$refs_output" | awk -F/ '{print $3}' | sort -V | tail -1 || true)"
  fi
  if [[ -z "$ref" ]]; then
    ref="main"
  fi
fi

LIB_URL="https://raw.githubusercontent.com/hunvreus/devpush/${ref}/scripts/lib.sh"

# Load lib.sh: prefer local copy; otherwise fetch from the resolved ref
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/lib.sh" ]]; then
  source "$SCRIPT_DIR/lib.sh"
elif command -v curl >/dev/null 2>&1; then
  if ! curl -fsSL "$LIB_URL" -o /tmp/devpush_lib.sh; then
    printf "Error: Unable to load lib.sh from %s\n" "$LIB_URL" >&2
    exit 1
  fi
  source /tmp/devpush_lib.sh
else
  printf "Error: Unable to load lib.sh (tried local and remote). curl not found. Try again or clone the repo manually.\n" >&2
  exit 1
fi

trap 's=$?; err "Install failed (exit $s)"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

usage() {
  cat <<USG
Usage: install.sh [--repo <url>] [--ref <ref>] [--ssh-pub <key_or_path>] [--harden] [--harden-ssh] [--yes] [--no-telemetry] [--ssl-provider <name>] [--verbose]

Install and configure /dev/push on a server (Docker, user, repo, .env).

  --repo URL             Git repo to clone (default: https://github.com/hunvreus/devpush.git)
  --ref REF              Git ref (branch/tag/commit) to install (default: latest stable tag)
  --ssh-pub KEY|PATH     Public key content or file to seed authorized_keys for the user
  --harden               Run system hardening at the end (non-fatal)
  --harden-ssh           Run SSH hardening at the end (non-fatal)
  --yes, -y              Non-interactive, proceed without prompts
  --no-telemetry         Do not send telemetry
  --ssl-provider         SSL provider: default|cloudflare|route53|gcloud|digitalocean|azure
  -v, --verbose          Enable verbose output for debugging
  -h, --help             Show this help
USG
  exit 0
}

# Parse CLI flags
repo="https://github.com/hunvreus/devpush.git"
ssh_pub=""; run_harden=0; run_harden_ssh=0; telemetry=1; ssl_provider="default"; yes_flag=0
[[ "${NO_TELEMETRY:-0}" == "1" ]] && telemetry=0

valid_ssl_providers="default|cloudflare|route53|gcloud|digitalocean|azure"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --ref) ref="$2"; shift 2 ;;
    --no-telemetry) telemetry=0; shift ;;
    --ssh-pub) ssh_pub="$2"; shift 2 ;;
    --harden) run_harden=1; shift ;;
    --harden-ssh) run_harden_ssh=1; shift ;;
    --ssl-provider)
      if [[ ! "$2" =~ ^(default|cloudflare|route53|gcloud|digitalocean|azure)$ ]]; then
        err "Invalid --ssl-provider: $2 (must be one of: $valid_ssl_providers)"
        exit 1
      fi
      ssl_provider="$2"
      shift 2
      ;;
    --yes|-y) yes_flag=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

user="devpush"
service_uid=""
service_gid=""

# Guard: prevent running in development mode
if [[ "$ENVIRONMENT" == "development" ]]; then
  err "install.sh is for production only. For development, install dependencies and start the stack (scripts/start.sh). More information: https://devpu.sh/docs/installation/#development"
  exit 1
fi

# Set up log file (timestamped) and track latest via symlink in /tmp
LOG_DIR="/tmp"
timestamp="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/devpush-install-${timestamp}.log"
mkdir -p "$LOG_DIR" || true
{
  printf "Install started: %s\n" "$(date -Iseconds)"
  printf "Effective ref: %s\n" "$ref"
} >"$LOG"
ln -sfn "$LOG" "$LOG_DIR/devpush-install.log"
exec > >(tee -a "$LOG") 2>&1
trap 's=$?; err "Install failed (exit $s). See $LOG"; printf "%b\n" "${RED}Last command: $BASH_COMMAND${NC}"; printf "%b\n" "${RED}Error output:${NC}"; cat "$SCRIPT_ERR_LOG" 2>/dev/null || printf "No error details captured\n"; exit $s' ERR

# Warn if remnants of a prior install are present
existing_summary=()
if [[ -f "$DATA_DIR/version.json" ]]; then
  version_ref=$(sed -n 's/.*"git_ref":"\([^"]*\)".*/\1/p' "$DATA_DIR/version.json" | head -n1)
  existing_summary+=("version.json in $DATA_DIR (ref: ${version_ref:-unknown})")
fi
[[ -d "$APP_DIR/.git" ]] && existing_summary+=("repo at $APP_DIR")
[[ -f "$DATA_DIR/.env" ]] && existing_summary+=(".env in $DATA_DIR")

if ((${#existing_summary[@]})); then
  printf '\n'
  printf "Existing install detected:\n"
  for line in "${existing_summary[@]}"; do
    printf "  - %s\n" "$line"
  done
  if (( yes_flag == 0 )); then
    printf "Run scripts/uninstall.sh or re-run this installer with --yes to overwrite.\n"
    exit 0
  fi
fi

# OS check (Debian/Ubuntu only)
. /etc/os-release || { err "Unsupported OS"; exit 1; }
case "${ID_LIKE:-$ID}" in
  *debian*|*ubuntu*) : ;;
  *) err "Only Ubuntu/Debian supported"; exit 1 ;;
esac
command -v apt-get >/dev/null || { err "apt-get not found"; exit 1; }

# Detect system info for metadata
arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
distro_id="${ID:-unknown}"
distro_version="${VERSION_ID:-unknown}"

# Show summary of what we're installing
printf '\n'
printf "Installing /dev/push:\n"
printf "  - Repo         : %s\n" "$repo"
printf "  - Ref/Version  : %s\n" "$ref"
printf "  - OS           : %s %s\n" "$distro_id" "$distro_version"
printf "  - Architecture : %s\n" "$arch"

# Banner
printf '\n'
printf "\033[38;5;51m    ██╗██████╗ ███████╗██╗   ██╗   ██╗██████╗ ██╗   ██╗███████╗██╗  ██╗\033[0m\n"
printf "\033[38;5;87m   ██╔╝██╔══██╗██╔════╝██║   ██║  ██╔╝██╔══██╗██║   ██║██╔════╝██║  ██║\033[0m\n"
printf "\033[38;5;123m  ██╔╝ ██║  ██║█████╗  ██║   ██║ ██╔╝ ██████╔╝██║   ██║███████╗███████║\033[0m\n"
printf "\033[38;5;159m ██╔╝  ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔╝  ██╔═══╝ ██║   ██║╚════██║██╔══██║\033[0m\n"
printf "\033[38;5;195m██╔╝   ██████╔╝███████╗ ╚████╔╝██╔╝   ██║     ╚██████╔╝███████║██║  ██║\033[0m\n"
printf "\033[38;5;225m╚═╝    ╚═════╝ ╚══════╝  ╚═══╝ ╚═╝    ╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝\033[0m\n"

# Ensure apt is fully non-interactive and avoid needrestart prompts
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
command -v curl >/dev/null || (apt-get update -yq && apt-get install -yq curl >/dev/null)

# Helpers
apt_install() {
  local pkgs=("$@"); local i
  for i in {1..5}; do
    if apt-get update -yq && apt-get install -yq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "${pkgs[@]}"; then return 0; fi
    sleep 3
  done
  return 1
}
gen_hex(){ openssl rand -hex 32; }
gen_pw(){ openssl rand -base64 24 | tr -d '\n=' | cut -c1-32; }
gen_fernet(){ openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'; }

# Helper functions (must be defined before use with run_cmd)
add_docker_repo() {
    install -m 0755 -d /etc/apt/keyrings
    case "${ID}" in
      ubuntu)
        gpg_url="https://download.docker.com/linux/ubuntu/gpg"
        codename="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
        repo_url="https://download.docker.com/linux/ubuntu"
        ;;
      debian|raspbian)
        gpg_url="https://download.docker.com/linux/debian/gpg"
        codename="${VERSION_CODENAME}"
        repo_url="https://download.docker.com/linux/debian"
        ;;
      *)
        if [[ "${ID_LIKE:-}" == *ubuntu* ]]; then
          gpg_url="https://download.docker.com/linux/ubuntu/gpg"
          codename="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
          repo_url="https://download.docker.com/linux/ubuntu"
        elif [[ "${ID_LIKE:-}" == *debian* ]]; then
          gpg_url="https://download.docker.com/linux/debian/gpg"
          codename="${VERSION_CODENAME}"
          repo_url="https://download.docker.com/linux/debian"
        else
          err "Unsupported distro for Docker repo: ID=${ID} ID_LIKE=${ID_LIKE:-}"
          exit 1
        fi
        ;;
    esac
    curl -fsSL "$gpg_url" | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    printf "deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] %s %s stable\n" "$arch" "$repo_url" "$codename" >/etc/apt/sources.list.d/docker.list
}

create_user() {
  if getent passwd "$user" >/dev/null 2>&1; then
    return 0
  fi
  useradd --system --user-group --home "$DATA_DIR" --shell /usr/sbin/nologin --no-create-home "$user"
}

record_version() {
  local commit ts install_id=""
  commit=$(runuser -u "$user" -- git -C "$APP_DIR" rev-parse --verify HEAD)
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  install -d -o "$user" -g "$user" -m 0755 "$DATA_DIR"
  if [[ -f "$DATA_DIR/version.json" ]]; then
    install_id=$(jq -r '.install_id // empty' "$DATA_DIR/version.json" 2>/dev/null || true)
  fi
  if [[ -z "$install_id" ]]; then
    install_id=$(cat /proc/sys/kernel/random/uuid)
  fi
  jq -n \
    --arg id "$install_id" \
    --arg ref "$ref" \
    --arg commit "$commit" \
    --arg ts "$ts" \
    --arg arch "$arch" \
    --arg distro "$distro_id" \
    --arg dv "$distro_version" \
    '{
      install_id: $id,
      git_ref: $ref,
      git_commit: $commit,
      updated_at: $ts,
      arch: $arch,
      distro: $distro,
      distro_version: $dv
    }' > "$DATA_DIR/version.json.tmp"
  mv "$DATA_DIR/version.json.tmp" "$DATA_DIR/version.json"
  chown "$user:$user" "$DATA_DIR/version.json" || true
  chmod 0644 "$DATA_DIR/version.json" || true
}

# Install base packages
printf '\n'
run_cmd "Installing base packages..." apt_install ca-certificates git jq curl gnupg

# Install Docker
printf '\n'
printf "Installing Docker...\n"
run_cmd "${CHILD_MARK} Adding Docker repository..." add_docker_repo
run_cmd "${CHILD_MARK} Installing Docker packages..." apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Ensure Docker service is running
run_cmd "${CHILD_MARK} Enabling Docker service..." systemctl enable --now docker
run_cmd "${CHILD_MARK} Waiting for Docker daemon..." bash -lc 'for i in $(seq 1 15); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'

# Create user
printf '\n'
printf "Preparing system user and data dirs...\n"
if ! id -u "$user" >/dev/null 2>&1; then
    run_cmd "${CHILD_MARK} Creating user '${user}'..." create_user
else
    printf "%s Creating user '%s'... ${YEL}⊘${NC}\n" "$CHILD_MARK" "$user"
    printf "  ${DIM}%s User already exists${NC}\n" "$CHILD_MARK"
fi
service_uid="$(id -u "$user")"
service_gid="$(id -g "$user")"

# Add data dirs
run_cmd "${CHILD_MARK} Preparing data directories..." install -o "$user" -g "$user" -m 0750 -d "$DATA_DIR" "$DATA_DIR/traefik" "$DATA_DIR/upload"

# Persist service metadata
persist_service_ids "$service_uid" "$service_gid"

# Persist SSL provider
persist_ssl_provider "$ssl_provider"

# Port conflicts warning
if command -v ss >/dev/null 2>&1; then
  if conflicts=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$|:443$/'); [[ -n "${conflicts:-}" ]]; then
    printf "${YEL}Warning:${NC} ports 80/443 are in use. Traefik may fail to start later.\n"
  fi
fi

# Create app dir
run_cmd "${CHILD_MARK} Creating app directory..." install -d -m 0755 "$APP_DIR"
run_cmd "${CHILD_MARK} Setting app directory ownership..." chown -R "$user:$user" "$APP_DIR"

# Get code from GitHub
printf '\n'
printf "Cloning repository...\n"
if [[ -d "$APP_DIR/.git" ]]; then
  # Repo exists, just fetch
  cmd_block="
    set -ex
    cd '$APP_DIR'
    git remote get-url origin >/dev/null 2>&1 || git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  run_cmd "${CHILD_MARK} Fetching updates for existing repo..." runuser -u "$user" -- bash -c "$cmd_block"
else
  # New clone
  cmd_block="
    set -ex
    cd '$APP_DIR'
    git init
    git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  run_cmd "${CHILD_MARK} Cloning new repository..." runuser -u "$user" -- bash -c "$cmd_block"
fi

run_cmd "${CHILD_MARK} Checking out: $ref" runuser -u "$user" -- git -C "$APP_DIR" reset --hard FETCH_HEAD

cd "$APP_DIR"

# Build runner images
printf '\n'
run_cmd "Building runner images..." bash "$APP_DIR/scripts/build-runners.sh"

# Save install metadata (version.json)
printf '\n'
run_cmd "Recording install metadata..." record_version

# Optional hardening (non-fatal) - run before telemetry
if ((run_harden==1)); then
  printf '\n'
  set +e
  run_cmd "Running server hardening..." bash "$APP_DIR/scripts/harden.sh" ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr=$?
  set -e
  if [[ $hr -ne 0 ]]; then
    printf "${YEL}Hardening skipped/failed. Install succeeded.${NC}\n"
  fi
fi

if ((run_harden_ssh==1)); then
  printf '\n'
  set +e
  run_cmd "Running SSH hardening..." bash "$APP_DIR/scripts/harden.sh" --ssh ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr2=$?
  set -e
  if [[ $hr2 -ne 0 ]]; then
    printf "${YEL}SSH hardening skipped/failed. Install succeeded.${NC}\n"
  fi
fi

# Send telemetry
if ((telemetry==1)); then
  printf '\n'
  if ! run_cmd_try "Sending telemetry..." send_telemetry install; then
    printf "  ${DIM}%s Telemetry failed (non-fatal). Continuing install.${NC}\n" "$CHILD_MARK"
  fi
fi

# Install systemd unit and start in setup mode
printf '\n'
printf "Installing systemd unit...\n"
unit_path="/etc/systemd/system/devpush.service"
install -m 0644 "$APP_DIR/scripts/devpush.service" "$unit_path"
systemctl daemon-reload
systemctl enable devpush.service

# Success message
printf '\n'
printf "${GRN}Install complete (version: %s). ✔${NC}\n" "$ref"

# Start stack
printf '\n'
run_cmd "Starting stack..." systemctl start devpush.service

# Show setup URL
sip=$(get_public_ip 2>/dev/null || true)
printf '\n'
if [ -z "$sip" ]; then
  printf "${YEL}Could not determine public IP; using localhost:${NC}\n"
  sip="127.0.0.1"
fi

printf "${GRN}Stack started. ✔${NC}\n"
printf "${YEL}Visit this URL to complete setup: http://%s${NC}\n" "$sip"
printf "${DIM}The app may take a little while to be ready.${NC}\n"
