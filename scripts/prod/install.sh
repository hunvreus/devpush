#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

RED="$(printf '\033[31m')"; GRN="$(printf '\033[32m')"; YEL="$(printf '\033[33m')"; BLD="$(printf '\033[1m')"; NC="$(printf '\033[0m')"
err(){ echo -e "${RED}ERR:${NC} $*" >&2; }
ok(){ echo -e "${GRN}$*${NC}"; }
info(){ echo -e "${BLD}$*${NC}"; }

# Capture stderr for error reporting
exec 2> >(tee /tmp/install_error.log >&2)

LOG=/var/log/devpush-install.log
mkdir -p "$(dirname "$LOG")" || true
exec > >(tee -a "$LOG") 2>&1
trap 's=$?; err "Install failed (exit $s). See $LOG"; echo -e "${RED}Last command: $BASH_COMMAND${NC}"; echo -e "${RED}Error output:${NC}"; cat /tmp/install_error.log 2>/dev/null || echo "No error details captured"; exit $s' ERR

usage() {
  cat <<USG
Usage: install.sh [--repo <url>] [--ref <tag>] [--include-prerelease] [--user devpush] [--app-dir <path>] [--ssh-pub <key_or_path>] [--harden] [--harden-ssh] [--no-telemetry]

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

  -h, --help             Show this help
USG
  exit 1
}

repo="https://github.com/hunvreus/devpush.git"; ref=""; include_pre=0; user="devpush"; app_dir=""; ssh_pub=""; run_harden=0; run_harden_ssh=0; telemetry=1

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

    -h|--help) usage ;;
    *) usage ;;
  esac
done

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

# Defer resolving app_dir until after user creation

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

# Install base packages
info "Installing base packages..."
apt_install ca-certificates git jq curl || { err "Base package install failed"; exit 1; }

# Install Docker
info "Installing Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release; echo $UBUNTU_CODENAME) stable" >/etc/apt/sources.list.d/docker.list
apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || { err "Docker install failed"; exit 1; }
ok "Docker installed."

# Install Loki driver
info "Installing Loki Docker driver..."
docker plugin inspect loki >/dev/null 2>&1 || docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
docker plugin inspect loki >/dev/null 2>&1 || { err "Failed to install Loki driver"; exit 1; }
ok "Loki driver ready."

# Create user
if ! id -u "$user" >/dev/null 2>&1; then
  info "Creating user '${user}'..."
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
  ok "User '${user}' created."
fi

# Add data dirs
info "Preparing data dirs..."
install -o 1000 -g 1000 -m 0755 -d /srv/devpush/traefik /srv/devpush/upload
ok "Data dirs ready."

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
if conflicts=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$|:443$/'); [[ -n "${conflicts:-}" ]]; then
  echo -e "${YEL}Warning:${NC} ports 80/443 are in use. Traefik may fail to start later."
fi

# Create app dir
info "Creating app directory..."
install -d -m 0755 "$app_dir" || { err "Failed to create directory '$app_dir'. Aborting."; exit 1; }
chown -R "$user:$(id -gn "$user")" "$app_dir" || { err "Failed to change ownership of '$app_dir' to '$user'. Aborting."; exit 1; }
ok "App directory is ready."

# Get code from GitHub
info "Cloning repository as user '${user}'..."
if [[ -d "$app_dir/.git" ]]; then
  # Repo exists, just fetch
  cmd_block="
    set -ex
    cd '$app_dir'
    git remote get-url origin >/dev/null 2>&1 || git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  runuser -u "$user" -- bash -c "$cmd_block" || { err "Git fetch failed for existing repo."; exit 1; }
else
  # New clone
  cmd_block="
    set -ex
    cd '$app_dir'
    git init
    git remote add origin '$repo'
    git fetch --depth 1 origin '$ref'
  "
  runuser -u "$user" -- bash -c "$cmd_block" || { err "Git clone failed."; exit 1; }
fi

info "Checking out ref: $ref"
runuser -u "$user" -- git -C "$app_dir" reset --hard FETCH_HEAD
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
info "Seeding access.json..."
install -d -m 0755 /srv/devpush || true
if [[ ! -f "/srv/devpush/access.json" ]]; then
  if [[ -f "$app_dir/access.example.json" ]]; then
    cp "$app_dir/access.example.json" "/srv/devpush/access.json"
  else
    cat > /srv/devpush/access.json <<'JSON'
{ "emails": [], "domains": [], "globs": [], "regex": [] }
JSON
  fi
  chown 1000:1000 /srv/devpush/access.json || true
  chmod 0644 /srv/devpush/access.json || true
  ok "Seeded /srv/devpush/access.json"
else
  ok "/srv/devpush/access.json exists; not modified."
fi

# Build runners images
if [[ -d Docker/runner ]]; then
  info "Building runner images..."
  runuser -u "$user" -- bash -lc '
    set -e
    for df in $(find Docker/runner -name "Dockerfile.*"); do
      n=$(basename "$df" | sed "s/^Dockerfile\.//")
      docker build -f "$df" -t "runner-$n" ./Docker/runner
    done
  '
  ok "Runner images built."
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
  info "Running server hardening..."
  set +e
  bash scripts/prod/harden.sh --user "$user" ${ssh_pub:+--ssh-pub "$ssh_pub"}
  hr=$?
  set -e
  if [[ $hr -ne 0 ]]; then
    echo -e "${YEL}Hardening skipped/failed. Install succeeded.${NC}"
  fi
fi

if ((run_harden_ssh==1)); then
  info "Running SSH hardening..."
  set +e
  bash scripts/prod/harden.sh --ssh --user "$user" ${ssh_pub:+--ssh-pub "$ssh_pub"}
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
echo "   Set LE_EMAIL, APP_HOSTNAME, DEPLOY_DOMAIN, EMAIL_SENDER_ADDRESS, SMTP Details or RESEND_API_KEY, GitHub App settings."
echo "3. Start the application: ${BLD}./scripts/prod/start.sh --migrate${NC}"