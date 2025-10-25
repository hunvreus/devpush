#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

: "${LIB_URL:=https://raw.githubusercontent.com/hunvreus/devpush/main/scripts/prod/lib.sh}"

# Capture stderr for error reporting
exec 2> >(tee /tmp/install_error.log >&2)

# Load lib.sh: prefer local; else try remote; else fail fast
if [[ -f "$(dirname "$0")/lib.sh" ]]; then
  source "$(dirname "$0")/lib.sh"
elif command -v curl >/dev/null 2>&1 && source <(curl -fsSL "$LIB_URL"); then
  :
else
  echo "Error: Unable to load lib.sh (tried local and remote). Try again or clone the repo manually." >&2
  exit 1
fi

LOG=/var/log/devpush-install.log
mkdir -p "$(dirname "$LOG")" || true
exec > >(tee -a "$LOG") 2>&1
trap 's=$?; err "Install failed (exit $s). See $LOG"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/install_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage() {
  cat <<USG
Usage: install.sh [--repo <url>] [--ref <tag>] [--include-prerelease] [--user devpush] [--app-dir <path>] [--ssh-pub <key_or_path>] [--harden] [--harden-ssh] [--no-telemetry] [--ssl-provider <name>] [--verbose]

Install and configure /dev/push on a server (Docker, Loki plugin, user, repo, .env).

  --repo URL             Git repo to clone (default: https://github.com/hunvreus/devpush.git)
  --ref TAG              Git tag/branch to install (default: latest stable tag, fallback to main)
  --include-prerelease   Allow beta/rc tags when selecting latest
  --user NAME            System user to own the app (default: devpush)
  --app-dir PATH         App directory (default: /home/<user>/devpush)
  --ssh-pub KEY|PATH     Public key content or file to seed authorized_keys for the user
  --harden               Run system hardening at the end (non-fatal)
  --harden-ssh           Run SSH hardening at the end (non-fatal)
  --no-telemetry         Do not send telemetry
  --ssl-provider         SSL provider: default|cloudflare|route53|gcloud|digitalocean|azure
  -h, --help             Show this help
  --verbose, -v        Enable verbose output for debugging
USG
  exit 1
}

repo="https://github.com/hunvreus/devpush.git"; ref=""; include_pre=0; user="devpush"; app_dir=""; ssh_pub=""; run_harden=0; run_harden_ssh=0; telemetry="${NO_TELEMETRY:-1}"; ssl_provider=""; yes_flag=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --user) user="$2"; shift 2 ;;
    --ref) ref="$2"; shift 2 ;;
    --include-prerelease) include_pre=1; shift ;;
    --no-telemetry) telemetry=0; shift ;;
    --app-dir) app_dir="$2"; shift 2 ;;
    --ssh-pub) ssh_pub="$2"; shift 2 ;;
    --harden) run_harden=1; shift ;;
    --harden-ssh) run_harden_ssh=1; shift ;;
    --ssl-provider) ssl_provider="$2"; shift 2 ;;
    --yes|-y) yes_flag=1; shift ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

# Set SSL provider: use --ssl-provider flag or default to "default"
[[ -z "$ssl_provider" ]] && ssl_provider="default"
persist_ssl_provider "$ssl_provider"

[[ $EUID -eq 0 ]] || { err "Run as root (sudo)."; exit 1; }

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

# Warn if ARM architecture
if [[ "$arch" == "arm64" || "$arch" == "aarch64" ]]; then
  printf "\n"
  echo "${YEL}Warning:${NC} ARM64 detected. Support is experimental; some components may not work (e.g. logging). Use x86_64/AMD64 for production."
fi

# Detect existing install and prompt
existing=0
summary() {
  if [[ -f /var/lib/devpush/version.json ]]; then
    ref=$(sed -n 's/.*"git_ref":"\([^"]*\)".*/\1/p' /var/lib/devpush/version.json | head -n1)
    commit=$(sed -n 's/.*"git_commit":"\([^"]*\)".*/\1/p' /var/lib/devpush/version.json | head -n1)
    echo -e "  - version.json in /var/lib/devpush (ref: ${ref:-unknown})"
  fi
  if [[ -d /home/devpush/devpush/.git ]]; then
    echo -e "  - repo at /home/devpush/devpush"
    [[ -f /home/devpush/devpush/.env ]] && echo -e "  - .env in /home/devpush/devpush"
  fi 
  if [[ -d /opt/devpush/.git ]]; then
    echo -e "  - repo at /opt/devpush"
    [[ -f /opt/devpush/.env ]] && echo -e "  - .env in /opt/devpush"
  fi
}

if [[ -f /var/lib/devpush/version.json ]] || [[ -d /home/devpush/devpush/.git ]] || [[ -d /opt/devpush/.git ]]; then
  existing=1
  echo ""
  echo "Existing install detected:"
  summary
  if (( yes_flag == 1 )); then
    echo -e "${DIM}${CHILD_MARK} Proceeding due to --yes${NC}"
  else
    if [[ -t 0 ]]; then
      read -r -p "Proceed with install anyway? [y/N] " ans
      if [[ ! "$ans" =~ ^[Yy]$ ]]; then
        echo "Aborted"
        exit 0
      fi
    else
      echo ""
      err "Re-run with --yes to proceed."
      exit 1
    fi
  fi
fi

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
pub_ip(){ curl -fsS https://api.ipify.org || curl -fsS http://checkip.amazonaws.com || hostname -I | awk '{print $1}'; }
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
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] ${repo_url} ${codename} stable" >/etc/apt/sources.list.d/docker.list
}

create_user() {
    useradd -m -U -s /bin/bash -G sudo,docker "$user"
    install -d -m 700 -o "$user" -g "$user" "/home/$user/.ssh"
    ak="/home/$user/.ssh/authorized_keys"
    if [[ -n "$ssh_pub" ]]; then
      if [[ -f "$ssh_pub" ]]; then cat "$ssh_pub" >> "$ak"; else echo "$ssh_pub" >> "$ak"; fi
    elif [[ -f /root/.ssh/authorized_keys ]]; then
      cat /root/.ssh/authorized_keys >> "$ak"
    fi
    if [[ -f "$ak" ]]; then chown "$user:$user" "$ak"; chmod 600 "$ak"; fi
    echo "$user ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/$user; chmod 440 /etc/sudoers.d/$user
}

seed_access_json() {
    install -d -m 0755 /srv/devpush || true
    if [[ -f "$app_dir/access.example.json" ]]; then
        cp "$app_dir/access.example.json" "/srv/devpush/access.json"
    else
        cat > /srv/devpush/access.json <<'JSON'
{ "emails": [], "domains": [], "globs": [], "regex": [] }
JSON
    fi
    chown 1000:1000 /srv/devpush/access.json || true
    chmod 0644 /srv/devpush/access.json || true
}

record_version() {
    local commit ts install_id
    commit=$(runuser -u "$user" -- git -C "$app_dir" rev-parse --verify HEAD)
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    install -d -m 0755 /var/lib/devpush
    if [[ ! -f /var/lib/devpush/version.json ]]; then
        install_id=$(cat /proc/sys/kernel/random/uuid)
        printf '{"install_id":"%s","git_ref":"%s","git_commit":"%s","updated_at":"%s","arch":"%s","distro":"%s","distro_version":"%s"}\n' "$install_id" "${ref}" "$commit" "$ts" "$arch" "$distro_id" "$distro_version" > /var/lib/devpush/version.json
    else
        install_id=$(jq -r '.install_id' /var/lib/devpush/version.json 2>/dev/null || true)
        [[ -n "$install_id" && "$install_id" != "null" ]] || install_id=$(cat /proc/sys/kernel/random/uuid)
        printf '{"install_id":"%s","git_ref":"%s","git_commit":"%s","updated_at":"%s","arch":"%s","distro":"%s","distro_version":"%s"}\n' "$install_id" "${ref}" "$commit" "$ts" "$arch" "$distro_id" "$distro_version" > /var/lib/devpush/version.json
    fi
    chown "$user:$user" /var/lib/devpush/version.json || true
    chmod 0644 /var/lib/devpush/version.json || true
}

send_telemetry() {
    local payload
    payload=$(jq -c --arg ev "install" '. + {event: $ev}' /var/lib/devpush/version.json 2>/dev/null || echo "")
    if [[ -n "$payload" ]]; then
        curl -fsSL -X POST -H 'Content-Type: application/json' -d "$payload" https://api.devpu.sh/v1/telemetry >/dev/null 2>&1 || true
    fi
}

# Install base packages
printf "\n"
run_cmd "Installing base packages..." apt_install ca-certificates git jq curl gnupg

# Install Docker
printf "\n"
echo "Installing Docker..."
run_cmd "${CHILD_MARK} Adding Docker repository..." add_docker_repo
run_cmd "${CHILD_MARK} Installing Docker packages..." apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Ensure Docker service is running
run_cmd "${CHILD_MARK} Enabling Docker service..." systemctl enable --now docker
run_cmd "${CHILD_MARK} Waiting for Docker daemon..." bash -lc 'for i in $(seq 1 15); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'

# Install Loki driver
if docker plugin inspect loki >/dev/null 2>&1; then
  echo "${CHILD_MARK} Installing Loki Docker driver... ${YEL}⊘${NC}"
  echo -e "  ${DIM}${CHILD_MARK} Plugin already installed${NC}"
else
  if run_cmd_try "${CHILD_MARK} Installing Loki Docker driver..." docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions --disable; then
    if run_cmd_try "${CHILD_MARK} Enabling Loki Docker driver..." docker plugin enable loki; then
      run_cmd_try "${CHILD_MARK} Waiting for Loki plugin socket..." bash -lc 'for i in $(seq 1 10); do ls /run/docker/plugins/*/loki.sock >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
    fi
  fi
  if ! docker plugin inspect loki --format '{{.Enabled}}' 2>/dev/null | grep -q true; then
    echo "${YEL}Warning:${NC} Loki plugin not fully enabled. Attempting Docker daemon restart and re-enable."
    run_cmd_try "${CHILD_MARK} Restarting Docker daemon..." systemctl restart docker
    run_cmd_try "${CHILD_MARK} Waiting for Docker daemon..." bash -lc 'for i in $(seq 1 15); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
    if run_cmd_try "${CHILD_MARK} Enabling Loki Docker driver (post-restart)..." docker plugin enable loki; then
      run_cmd_try "${CHILD_MARK} Waiting for Loki plugin socket (post-restart)..." bash -lc 'for i in $(seq 1 10); do ls /run/docker/plugins/*/loki.sock >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
    fi
  fi
  if ! docker plugin inspect loki --format '{{.Enabled}}' 2>/dev/null | grep -q true; then
    echo "${YEL}Warning:${NC} Loki plugin install failed; continuing without it."
  fi
fi

# Create user
printf "\n"
echo "Preparing system user and data dirs..."
if ! id -u "$user" >/dev/null 2>&1; then
    run_cmd "${CHILD_MARK} Creating user '${user}'..." create_user
else
    echo "${CHILD_MARK} Creating user '${user}'... ${YEL}⊘${NC}"
    echo -e "  ${DIM}${CHILD_MARK} User already exists${NC}"
fi

# Add data dirs
run_cmd "${CHILD_MARK} Preparing data directories..." install -o 1000 -g 1000 -m 0755 -d /srv/devpush/traefik /srv/devpush/upload

# Resolve app_dir now that user state is known
if [[ -z "${app_dir:-}" ]]; then
  if id -u "$user" >/dev/null 2>&1 && [[ -d "/home/$user" ]]; then
    app_dir="/home/$user/devpush"
  else
    app_dir="/opt/devpush"
  fi
fi

# Resolve ref (latest tag, fallback to main)
printf "\n"
echo "Resolving ref to install..."
if [[ -z "$ref" ]]; then
  if ((include_pre==1)); then
    ref="$(git ls-remote --tags --refs "$repo" 2>/dev/null | awk -F/ '{print $3}' | sort -V | tail -1 || true)"
  else
    ref="$(git ls-remote --tags --refs "$repo" 2>/dev/null | awk -F/ '{print $3}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
    [[ -n "$ref" ]] || ref="$(git ls-remote --tags --refs "$repo" 2>/dev/null | awk -F/ '{print $3}' | sort -V | tail -1 || true)"
  fi
  [[ -n "$ref" ]] || ref="main"
fi

# Port conflicts warning
if command -v ss >/dev/null 2>&1; then
  if conflicts=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$|:443$/'); [[ -n "${conflicts:-}" ]]; then
    echo -e "${YEL}Warning:${NC} ports 80/443 are in use. Traefik may fail to start later."
  fi
fi

# Create app dir
run_cmd "${CHILD_MARK} Creating app directory..." install -d -m 0755 "$app_dir"
run_cmd "${CHILD_MARK} Setting app directory ownership..." chown -R "$user:$(id -gn "$user")" "$app_dir"

# Get code from GitHub
printf "\n"
echo "Cloning repository..."
if [[ -d "$app_dir/.git" ]]; then
  # Repo exists, just fetch
  cmd_block="
    set -ex
    cd '$app_dir'
    git remote get-url origin >/dev/null 2>&1 || git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  run_cmd "${CHILD_MARK} Fetching updates for existing repo..." runuser -u "$user" -- bash -c "$cmd_block"
else
  # New clone
  cmd_block="
    set -ex
    cd '$app_dir'
    git init
    git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  run_cmd "${CHILD_MARK} Cloning new repository..." runuser -u "$user" -- bash -c "$cmd_block"
fi

run_cmd "${CHILD_MARK} Checking out ref: $ref" runuser -u "$user" -- git -C "$app_dir" reset --hard FETCH_HEAD

# Create .env file
printf "\n"
echo "Configuring environment..."
cd "$app_dir"
if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    run_cmd "${CHILD_MARK} Create .env from template..." bash -lc "runuser -u '$user' -- cp '.env.example' '.env' && chown '$user:$user' '.env'"
  else
    err ".env.example not found; cannot create .env"
    exit 1
  fi
  # Fill generated/defaults if empty
  fill(){ k="$1"; v="$2"; if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$k=\"$v\"|" .env; else echo "$k=\"$v\"" >> .env; fi; }
  fill_if_empty(){ k="$1"; v="$2"; cur="$(grep -E "^$k=" .env | head -n1 | cut -d= -f2- | tr -d '\"')"; [[ -z "$cur" ]] && fill "$k" "$v" || true; }

  sk="$(gen_hex)"; ek="$(gen_fernet)"; pgp="$(gen_pw)"; sip="$(pub_ip || echo 127.0.0.1)"
  fill_if_empty SECRET_KEY "$sk"
  fill_if_empty ENCRYPTION_KEY "$ek"
  fill_if_empty POSTGRES_PASSWORD "$pgp"
  fill_if_empty SERVER_IP "$sip"
else
  echo "${CHILD_MARK} Create .env from template... ${YEL}⊘${NC}"
  echo -e "  ${DIM}${CHILD_MARK} .env already exists${NC}"
fi

# Seed access.json for per-file mount
if [[ ! -f "/srv/devpush/access.json" ]]; then
    run_cmd "${CHILD_MARK} Seeding access.json..." seed_access_json
else
    echo "${CHILD_MARK} Seeding access.json... ${YEL}⊘${NC}"
    echo -e "  ${DIM}${CHILD_MARK} File already exists${NC}"
fi

# Build runners images
printf "\n"
if [[ -d Docker/runner ]]; then
  build_runners_cmd="
    set -e
    for df in \$(find Docker/runner -name 'Dockerfile.*'); do
      n=\$(basename "\$df" | sed 's/^Dockerfile\.//')
      docker build -f "\$df" -t "runner-\$n" ./Docker/runner
    done
  "
  run_cmd "Building runner images..." runuser -u "$user" -- bash -lc "$build_runners_cmd"
fi

# Save install metadata (version.json)
printf "\n"
run_cmd "Recording install metadata..." record_version

# Send telemetry
if ((telemetry==1)); then
  printf "\n"
  run_cmd "Sending telemetry..." send_telemetry
fi

# Optional hardening (non-fatal)
if ((run_harden==1)); then
  printf "\n"
  set +e
  run_cmd "Running server hardening..." bash scripts/prod/harden.sh --user "$user" ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr=$?
  set -e
  if [[ $hr -ne 0 ]]; then
    echo -e "${YEL}Hardening skipped/failed. Install succeeded.${NC}"
  fi
fi

if ((run_harden_ssh==1)); then
  printf "\n"
  set +e
  run_cmd "Running SSH hardening..." bash scripts/prod/harden.sh --ssh --user "$user" ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr2=$?
  set -e
  if [[ $hr2 -ne 0 ]]; then
    echo -e "${YEL}SSH hardening skipped/failed. Install succeeded.${NC}"
  fi
fi

printf "\n"
echo -e "${GRN}Install complete (version: ${ref}). ✔${NC}"
echo ""
echo "Next:"
echo "  1) sudo -iu ${user}"
echo "  2) cd devpush && vi .env"
echo "     Fill: LE_EMAIL, APP_HOSTNAME, DEPLOY_DOMAIN, EMAIL_SENDER_ADDRESS, RESEND_API_KEY, GitHub App vars (GITHUB_APP_ID, GITHUB_APP_NAME, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET)"
echo "  3) ./scripts/prod/start.sh --migrate [--ssl-provider <cloudflare|route53|gcloud|digitalocean|azure>]"