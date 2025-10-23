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
  echo "ERR: Unable to load lib.sh (tried local and remote). Try again or clone the repo manually (https://github.com/hunvreus/devpush)." >&2
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

repo="https://github.com/hunvreus/devpush.git"; ref=""; include_pre=0; user="devpush"; app_dir=""; ssh_pub=""; run_harden=0; run_harden_ssh=0; telemetry=1; ssl_provider=""

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
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

# Persist ssl_provider selection if provided, otherwise interactively ask (if TTY)
if [[ -n "$ssl_provider" ]]; then
  persist_ssl_provider "$ssl_provider"
else
  # If interactive, prompt once; otherwise fall back to env/config/default
  if [[ -t 0 && -t 1 ]]; then
    echo ""
    echo "Select SSL provider (arrow keys not needed, type number and press Enter):"
    echo "  1) default        (HTTP-01 on :80 → auto-redirect to HTTPS)"
    echo "  2) cloudflare     (DNS-01 via CF_DNS_API_TOKEN)"
    echo "  3) route53        (DNS-01 via AWS creds)"
    echo "  4) digitalocean   (DNS-01 via DO_AUTH_TOKEN)"
    echo "  5) gcloud         (DNS-01 via GCE_PROJECT + service account)"
    echo "  6) azure          (DNS-01 via Azure credentials)"
    read -r -p "Choice [1-6] (default: 1): " choice || true
    case "${choice:-1}" in
      1) ssl_provider="default" ;;
      2) ssl_provider="cloudflare" ;;
      3) ssl_provider="route53" ;;
      4) ssl_provider="digitalocean" ;;
      5) ssl_provider="gcloud" ;;
      6) ssl_provider="azure" ;;
      *) ssl_provider="default" ;;
    esac
    persist_ssl_provider "$ssl_provider"
    echo "Selected SSL provider: $ssl_provider"
  else
    # Non-interactive: resolve from env/config, fallback to default
    ssl_provider="$(get_ssl_provider)"
    persist_ssl_provider "$ssl_provider"
  fi
fi

[[ $EUID -eq 0 ]] || { err "Run as root (sudo)."; exit 1; }

# OS check (Debian/Ubuntu only)
. /etc/os-release || { err "Unsupported OS"; exit 1; }
case "${ID_LIKE:-$ID}" in
  *debian*|*ubuntu*) : ;;
  *) err "Only Ubuntu/Debian supported"; exit 1 ;;
esac
command -v apt-get >/dev/null || { err "apt-get not found"; exit 1; }

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
    arch="$(dpkg --print-architecture)"
    . /etc/os-release
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

# Install base packages
run_cmd "Installing base packages..." apt_install ca-certificates git jq curl gnupg

# Install Docker
info "Installing Docker..."
run_cmd "  Adding Docker repository..." add_docker_repo
run_cmd "  Installing Docker packages..." apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Ensure Docker service is running (best-effort)
run_cmd "Enabling Docker service..." systemctl enable --now docker

# Install Loki driver
# The check needs to run directly, but the install can be wrapped
if docker plugin inspect loki >/dev/null 2>&1; then
  ok "Loki Docker plugin already installed."
else
    run_cmd "Installing Loki Docker driver..." docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
fi

# Create user
if ! id -u "$user" >/null 2>&1; then
    run_cmd "Creating user '${user}'..." create_user
else
    ok "User '${user}' already exists."
fi

# Add data dirs
run_cmd "Preparing data directories..." install -o 1000 -g 1000 -m 0755 -d /srv/devpush/traefik /srv/devpush/upload

# Resolve app_dir now that user state is known
if [[ -z "${app_dir:-}" ]]; then
  if id -u "$user" >/dev/null 2>&1 && [[ -d "/home/$user" ]]; then
    app_dir="/home/$user/devpush"
  else
    app_dir="/opt/devpush"
  fi
fi

# Resolve ref (latest tag, fallback to main)
info "Resolving ref to install..."
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
run_cmd "Creating app directory..." install -d -m 0755 "$app_dir"
run_cmd "Setting app directory ownership..." chown -R "$user:$(id -gn "$user")" "$app_dir"
ok "App directory is ready."

# Get code from GitHub
info "Cloning repository..."
if [[ -d "$app_dir/.git" ]]; then
  # Repo exists, just fetch
  cmd_block="
    set -ex
    cd '$app_dir'
    git remote get-url origin >/dev/null 2>&1 || git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  run_cmd "  Fetching updates for existing repo..." runuser -u "$user" -- bash -c "$cmd_block"
else
  # New clone
  cmd_block="
    set -ex
    cd '$app_dir'
    git init
    git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  run_cmd "  Cloning new repository..." runuser -u "$user" -- bash -c "$cmd_block"
fi

run_cmd "Checking out ref: $ref" runuser -u "$user" -- git -C "$app_dir" reset --hard FETCH_HEAD
ok "Repo ready at $app_dir (ref $ref)."

# Create .env file
cd "$app_dir"
if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    runuser -u "$user" -- cp ".env.example" ".env"
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
  chown "$user:$user" .env
  ok ".env created from template (edit before start)."
else
  ok ".env exists; not modified."
fi

# Seed access.json for per-file mount
if [[ ! -f "/srv/devpush/access.json" ]]; then
    run_cmd "Seeding access.json..." seed_access_json
else
    ok "/srv/devpush/access.json exists; not modified."
fi

# Build runners images
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
commit=$(runuser -u "$user" -- git -C "$app_dir" rev-parse --verify HEAD)
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
install -d -m 0755 /var/lib/devpush
if [[ ! -f /var/lib/devpush/version.json ]]; then
  install_id=$(cat /proc/sys/kernel/random/uuid)
  printf '{"install_id":"%s","git_ref":"%s","git_commit":"%s","updated_at":"%s"}\n' "$install_id" "${ref}" "$commit" "$ts" > /var/lib/devpush/version.json
else
  install_id=$(jq -r '.install_id' /var/lib/devpush/version.json 2>/dev/null || true)
  [[ -n "$install_id" && "$install_id" != "null" ]] || install_id=$(cat /proc/sys/kernel/random/uuid)
  printf '{"install_id":"%s","git_ref":"%s","git_commit":"%s","updated_at":"%s"}\n' "$install_id" "${ref}" "$commit" "$ts" > /var/lib/devpush/version.json
fi
chown "$user:$user" /var/lib/devpush/version.json || true
chmod 0644 /var/lib/devpush/version.json || true

# Send telemetry
if ((telemetry==1)); then
  payload=$(jq -c --arg ev "install" '. + {event: $ev}' /var/lib/devpush/version.json 2>/dev/null || echo "")
  if [[ -n "$payload" ]]; then
    curl -fsSL -X POST -H 'Content-Type: application/json' -d "$payload" https://api.devpu.sh/v1/telemetry >/dev/null 2>&1 || true
  fi
fi

# Optional hardening (non-fatal)
if ((run_harden==1)); then
  set +e
  run_cmd "Running server hardening..." bash scripts/prod/harden.sh --user "$user" ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr=$?
  set -e
  if [[ $hr -ne 0 ]]; then
    echo -e "${YEL}Hardening skipped/failed. Install succeeded.${NC}"
  fi
fi

if ((run_harden_ssh==1)); then
  set +e
  run_cmd "Running SSH hardening..." bash scripts/prod/harden.sh --ssh --user "$user" ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr2=$?
  set -e
  if [[ $hr2 -ne 0 ]]; then
    echo -e "${YEL}SSH hardening skipped/failed. Install succeeded.${NC}"
  fi
fi

ok "Install complete."
echo ""
info "Next steps:"
echo "1. Switch to the app user: ${BLD}sudo -iu ${user}${NC}"
echo "2. Change dir and edit .env: ${BLD}cd devpush && vi .env${NC}"
echo "   Set LE_EMAIL, APP_HOSTNAME, DEPLOY_DOMAIN, EMAIL_SENDER_ADDRESS, RESEND_API_KEY, GitHub App settings (GITHUB_APP_ID, GITHUB_APP_NAME, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET)."
echo "3. Start the application: ${BLD}./scripts/prod/start.sh --migrate${NC}"