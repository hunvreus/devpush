export const AGENT_INSTALL_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

if [ -t 1 ] && [ -z "\${NO_COLOR:-}" ]; then
  BOLD='\\033[1m'
  DIM='\\033[2m'
  GREEN='\\033[32m'
  YELLOW='\\033[33m'
  RED='\\033[31m'
  CYAN_1='\\033[38;5;51m'
  CYAN_2='\\033[38;5;87m'
  CYAN_3='\\033[38;5;123m'
  CYAN_4='\\033[38;5;159m'
  CYAN_5='\\033[38;5;195m'
  CYAN_6='\\033[38;5;225m'
  RESET='\\033[0m'
else
  BOLD=''
  DIM=''
  GREEN=''
  YELLOW=''
  RED=''
  CYAN_1=''
  CYAN_2=''
  CYAN_3=''
  CYAN_4=''
  CYAN_5=''
  CYAN_6=''
  RESET=''
fi

info() { printf "  %b::%b %s\n" "\${BOLD}" "\${RESET}" "$1"; }
ok() { printf "  %bOK%b %s\n" "\${GREEN}" "\${RESET}" "$1"; }
warn() { printf "  %b!!%b %s\n" "\${YELLOW}" "\${RESET}" "$1" >&2; }
fail() {
  printf "\n  %bERROR%b %s\n" "\${RED}" "\${RESET}" "$1" >&2
  if [ -n "\${INSTALL_LOG:-}" ]; then
    printf "  Log: %s\n" "\${INSTALL_LOG}" >&2
  fi
  exit 1
}

printf '\n'
printf '%b%s%b\n' "\${CYAN_1}" '    ██╗██████╗ ███████╗██╗   ██╗   ██╗██████╗ ██╗   ██╗███████╗██╗  ██╗' "\${RESET}"
printf '%b%s%b\n' "\${CYAN_2}" '   ██╔╝██╔══██╗██╔════╝██║   ██║  ██╔╝██╔══██╗██║   ██║██╔════╝██║  ██║' "\${RESET}"
printf '%b%s%b\n' "\${CYAN_3}" '  ██╔╝ ██║  ██║█████╗  ██║   ██║ ██╔╝ ██████╔╝██║   ██║███████╗███████║' "\${RESET}"
printf '%b%s%b\n' "\${CYAN_4}" ' ██╔╝  ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔╝  ██╔═══╝ ██║   ██║╚════██║██╔══██║' "\${RESET}"
printf '%b%s%b\n' "\${CYAN_5}" '██╔╝   ██████╔╝███████╗ ╚████╔╝██╔╝   ██║     ╚██████╔╝███████║██║  ██║' "\${RESET}"
printf '%b%s%b\n' "\${CYAN_6}" '╚═╝    ╚═════╝ ╚══════╝  ╚═══╝ ╚═╝    ╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝' "\${RESET}"
printf '\n'

if [ "$(id -u)" -ne 0 ]; then
  fail "Run this installer with sudo."
fi

if [ -z "\${DEVPUSH_BASE_URL:-}" ]; then
  fail "DEVPUSH_BASE_URL is required."
fi

if [ -z "\${DEVPUSH_AGENT_TOKEN:-}" ]; then
  fail "DEVPUSH_AGENT_TOKEN is required."
fi

AGENT_USER="\${DEVPUSH_AGENT_USER:-devpush}"
INSTALL_ROOT="\${DEVPUSH_INSTALL_ROOT:-}"
BINARY_URL="\${DEVPUSH_AGENT_BINARY_URL:-}"
CHECKSUM_URL="\${DEVPUSH_AGENT_CHECKSUM_URL:-}"
AUTO_UPDATE="\${DEVPUSH_AGENT_AUTO_UPDATE:-false}"
DEFAULT_BINARY_URL=false

detect_os() {
  case "$(uname -s)" in
    Linux) printf "linux" ;;
    *)
      fail "Unsupported OS: $(uname -s). devpush agents currently require Linux."
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) printf "amd64" ;;
    aarch64 | arm64) printf "arm64" ;;
    *)
      fail "Unsupported CPU architecture: $(uname -m)"
      ;;
  esac
}

if [ -z "\${BINARY_URL}" ]; then
  BINARY_OS="$(detect_os)"
  BINARY_ARCH="$(detect_arch)"
  BINARY_URL="\${DEVPUSH_BASE_URL%/}/api/install/agent/binary?os=\${BINARY_OS}&arch=\${BINARY_ARCH}"
  CHECKSUM_URL="\${DEVPUSH_BASE_URL%/}/api/install/agent/checksum?os=\${BINARY_OS}&arch=\${BINARY_ARCH}"
  DEFAULT_BINARY_URL=true
fi

BINARY_OS="\${BINARY_OS:-$(detect_os)}"
BINARY_ARCH="\${BINARY_ARCH:-$(detect_arch)}"

if [ -r /etc/os-release ]; then
  . /etc/os-release
fi

DISTRO_ID="\${ID:-unknown}"
DISTRO_NAME="\${PRETTY_NAME:-\${NAME:-unknown Linux}}"
PACKAGE_MANAGER=none
if command -v apt-get >/dev/null 2>&1; then
  PACKAGE_MANAGER=apt
elif command -v dnf >/dev/null 2>&1; then
  PACKAGE_MANAGER=dnf
elif command -v yum >/dev/null 2>&1; then
  PACKAGE_MANAGER=yum
fi

target_path() {
  printf "%s%s" "\${INSTALL_ROOT}" "$1"
}

LOG_DIR="$(target_path /var/log/devpush-agent)"
INSTALL_LOG="\${LOG_DIR}/install-$(date -u +%Y%m%d-%H%M%S).log"
install -d -m 0700 "\${LOG_DIR}"
: >"\${INSTALL_LOG}"
chmod 0600 "\${INSTALL_LOG}"
ln -sfn "$(basename "\${INSTALL_LOG}")" "\${LOG_DIR}/latest.log"
exec > >(tee -a "\${INSTALL_LOG}") 2>&1

printf '%bInstallation summary%b\n\n' "\${BOLD}" "\${RESET}"
printf '  Host          %s\n' "\${DISTRO_NAME}"
printf '  Architecture  %s\n' "\${BINARY_ARCH}"
printf '  Control plane %s\n' "\${DEVPUSH_BASE_URL}"
printf '  Agent user    %s\n' "\${AGENT_USER}"
printf '  Auto-update   %s\n\n' "\${AUTO_UPDATE}"

install_agent_dir() {
  local mode="$1"
  local path="$2"

  if [ -n "\${INSTALL_ROOT}" ]; then
    install -d -m "\${mode}" "\${path}"
  else
    install -d -m "\${mode}" -o "\${AGENT_USER}" -g "\${AGENT_USER}" "\${path}"
  fi
}

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required to download and verify the agent."
fi

WORK_DIR="$(mktemp -d)"
STEP_LOG="\${WORK_DIR}/step.log"
trap 'rm -rf "\${WORK_DIR}"' EXIT

run_step() {
  local message="$1"
  shift
  info "\${message}"
  : >"\${STEP_LOG}"
  if "$@" >"\${STEP_LOG}" 2>&1; then
    cat "\${STEP_LOG}" >>"\${INSTALL_LOG}"
    ok "\${message}"
    return
  fi

  cat "\${STEP_LOG}" >>"\${INSTALL_LOG}"
  tail -n 40 "\${STEP_LOG}" >&2 || true
  fail "\${message} failed."
}

try_step() {
  local message="$1"
  shift
  info "\${message}"
  : >"\${STEP_LOG}"
  if "$@" >"\${STEP_LOG}" 2>&1; then
    cat "\${STEP_LOG}" >>"\${INSTALL_LOG}"
    ok "\${message}"
    return 0
  fi
  cat "\${STEP_LOG}" >>"\${INSTALL_LOG}"
  return 1
}

install_packages() {
  case "\${PACKAGE_MANAGER}" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
      ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
    *) return 1 ;;
  esac
}

install_docker() {
  case "\${PACKAGE_MANAGER}" in
    apt)
      case "\${DISTRO_ID}" in
        debian | ubuntu) ;;
        *) return 1 ;;
      esac
      DEBIAN_FRONTEND=noninteractive apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/\${DISTRO_ID}/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      . /etc/os-release
      printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
        "$(dpkg --print-architecture)" "\${DISTRO_ID}" "\${VERSION_CODENAME}" \
        >/etc/apt/sources.list.d/docker.list
      DEBIAN_FRONTEND=noninteractive apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    dnf)
      local repo_family
      case "\${DISTRO_ID}" in
        fedora) repo_family=fedora ;;
        centos | rhel | rocky | almalinux) repo_family=centos ;;
        *) return 1 ;;
      esac
      dnf install -y dnf-plugins-core
      dnf config-manager --add-repo "https://download.docker.com/linux/\${repo_family}/docker-ce.repo"
      dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    yum)
      local repo_family
      case "\${DISTRO_ID}" in
        centos | rhel) repo_family=centos ;;
        *) return 1 ;;
      esac
      yum install -y yum-utils
      yum-config-manager --add-repo "https://download.docker.com/linux/\${repo_family}/docker-ce.repo"
      yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    *) return 1 ;;
  esac
}

if ! command -v git >/dev/null 2>&1; then
  if [ "\${PACKAGE_MANAGER}" = none ]; then
    fail "Git is required. Install it and run this command again."
  fi
  run_step "Installing Git and CA certificates" install_packages git ca-certificates
else
  ok "Git is available"
fi

if ! command -v docker >/dev/null 2>&1; then
  run_step "Installing Docker Engine and Compose" install_docker
else
  ok "Docker is available"
fi

if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemd is required to manage the devpush agent."
fi

run_step "Enabling Docker" systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  if [ "\${PACKAGE_MANAGER}" = none ]; then
    fail "The Docker Compose plugin is required."
  fi
  run_step "Installing Docker Compose" install_packages docker-compose-plugin
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "The Docker Compose plugin is required. Install it and run this command again."
fi
ok "Docker Compose is available"

if ! command -v rclone >/dev/null 2>&1; then
  if [ "\${PACKAGE_MANAGER}" != none ]; then
    if ! try_step "Installing rclone for remote backups" install_packages rclone; then
      warn "rclone could not be installed; remote backups will remain unavailable."
    fi
  fi
fi

if ! command -v rclone >/dev/null 2>&1; then
  warn "rclone is unavailable; install it before enabling remote backups."
else
  ok "rclone is available"
fi

if [ -z "\${INSTALL_ROOT}" ] && ! id -u "\${AGENT_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/devpush-agent --shell /usr/sbin/nologin "\${AGENT_USER}"
fi

if getent group docker >/dev/null 2>&1; then
  if [ -z "\${INSTALL_ROOT}" ]; then
    usermod -aG docker "\${AGENT_USER}"
  fi
  SUPPLEMENTARY_GROUPS="SupplementaryGroups=docker"
else
  SUPPLEMENTARY_GROUPS=""
fi

ETC_DIR="$(target_path /etc/devpush)"
STATE_DIR="$(target_path /var/lib/devpush-agent)"
BIN_DIR="$(target_path /usr/local/bin)"
SYSTEMD_DIR="$(target_path /etc/systemd/system)"
LIB_DIR="$(target_path /usr/local/lib/devpush)"

install -d -m 0755 "\${ETC_DIR}"
install_agent_dir 0750 "\${STATE_DIR}"
install -d -m 0755 "\${BIN_DIR}"
install -d -m 0755 "\${SYSTEMD_DIR}"
install -d -m 0755 "\${LIB_DIR}"

binary_name="devpush-agent-\${BINARY_OS}-\${BINARY_ARCH}"
tmp_binary="\${WORK_DIR}/\${binary_name}"
run_step "Downloading devpush agent" curl -fsSL "\${BINARY_URL}" -o "\${tmp_binary}"

if [ -n "\${CHECKSUM_URL}" ]; then
  if ! command -v sha256sum >/dev/null 2>&1; then
    fail "sha256sum is required to verify the agent binary."
  fi
  run_step "Downloading agent checksum" curl -fsSL "\${CHECKSUM_URL}" -o "\${WORK_DIR}/checksum"
  run_step "Verifying agent checksum" bash -c 'cd "$1" && sha256sum -c checksum' _ "\${WORK_DIR}"
elif [ "\${DEFAULT_BINARY_URL}" = true ]; then
  fail "The control plane did not provide an agent checksum URL."
else
  warn "A custom binary URL was supplied without DEVPUSH_AGENT_CHECKSUM_URL; its checksum was not verified."
fi

if [ -f "\${ETC_DIR}/agent.env" ] && [ -x "\${BIN_DIR}/devpush-agent" ]; then
  previous_base="$(sed -n 's/^DEVPUSH_BASE_URL="\\(.*\\)"$/\\1/p' "\${ETC_DIR}/agent.env")"
  if [ "\${previous_base%/}" != "\${DEVPUSH_BASE_URL%/}" ]; then
    fail "Use devpush-agent maintenance switch to change control planes safely."
  fi
  if systemctl is-active --quiet devpush-agent; then
    # The existing process drains jobs before an atomic binary replacement.
    run_step "Safely updating devpush agent" "\${BIN_DIR}/devpush-agent" maintenance update --binary "\${tmp_binary}"
  elif ! cmp -s "\${tmp_binary}" "\${BIN_DIR}/devpush-agent"; then
    install -m 0755 "\${tmp_binary}" "\${BIN_DIR}/devpush-agent.new"
    mv "\${BIN_DIR}/devpush-agent.new" "\${BIN_DIR}/devpush-agent"
  fi
  previous_token="$(sed -n 's/^DEVPUSH_AGENT_TOKEN="\\(.*\\)"$/\\1/p' "\${ETC_DIR}/agent.env")"
  if [ -n "\${previous_token}" ]; then DEVPUSH_AGENT_TOKEN="\${previous_token}"; fi
else
  install -m 0755 "\${tmp_binary}" "\${BIN_DIR}/devpush-agent"
fi
AGENT_VERSION="$("\${BIN_DIR}/devpush-agent" version 2>/dev/null || printf unknown)"
ok "Installed \${AGENT_VERSION}"

cat >"\${ETC_DIR}/agent.env" <<EOF
DEVPUSH_BASE_URL="\${DEVPUSH_BASE_URL}"
DEVPUSH_AGENT_TOKEN="\${DEVPUSH_AGENT_TOKEN}"
DEVPUSH_STATE_DIR="\${STATE_DIR}"
EOF

if [ -n "\${DEVPUSH_TRAEFIK_EMAIL:-}" ]; then
  printf 'DEVPUSH_TRAEFIK_EMAIL="%s"\\n' "\${DEVPUSH_TRAEFIK_EMAIL}" >>"\${ETC_DIR}/agent.env"
fi

if [ -z "\${INSTALL_ROOT}" ]; then
  chown root:"\${AGENT_USER}" "\${ETC_DIR}/agent.env"
fi
chmod 0640 "\${ETC_DIR}/agent.env"

cat >"\${LIB_DIR}/update-agent" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

source /etc/devpush/agent.env

case "$(uname -s)" in Linux) os=linux ;; *) echo "Unsupported OS." >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "Unsupported architecture." >&2; exit 1 ;; esac
base="\${DEVPUSH_BASE_URL%/}/api/install/agent"
tmp="$(mktemp -d)"
trap 'rm -rf "\${tmp}"' EXIT
echo "Downloading devpush agent..."
curl -fsSL "\${base}/binary?os=\${os}&arch=\${arch}" -o "\${tmp}/devpush-agent-linux-\${arch}"
curl -fsSL "\${base}/checksum?os=\${os}&arch=\${arch}" -o "\${tmp}/checksum"
echo "Verifying downloaded binary..."
(cd "\${tmp}" && sha256sum -c checksum)
if cmp -s "\${tmp}/devpush-agent-linux-\${arch}" /usr/local/bin/devpush-agent; then
  echo "devpush agent is already current."
  exit 0
fi
/usr/local/bin/devpush-agent maintenance update --binary "\${tmp}/devpush-agent-linux-\${arch}"
echo "devpush agent updated."
EOF
chmod 0755 "\${LIB_DIR}/update-agent"

cat >"\${SYSTEMD_DIR}/devpush-agent.service" <<EOF
[Unit]
Description=devpush agent
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
User=\${AGENT_USER}
Group=\${AGENT_USER}
\${SUPPLEMENTARY_GROUPS}
EnvironmentFile=\${ETC_DIR}/agent.env
ExecStart=\${BIN_DIR}/devpush-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat >"\${SYSTEMD_DIR}/devpush-agent-update.service" <<EOF
[Unit]
Description=Update devpush agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=\${LIB_DIR}/update-agent
EOF

cat >"\${SYSTEMD_DIR}/devpush-agent-update.timer" <<EOF
[Unit]
Description=Check for devpush agent updates daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

run_step "Registering the systemd service" systemctl daemon-reload
run_step "Starting the devpush agent" systemctl enable --now devpush-agent

if [ "\${AUTO_UPDATE}" = "true" ]; then
  systemctl enable --now devpush-agent-update.timer
else
  systemctl disable --now devpush-agent-update.timer >/dev/null 2>&1 || true
fi

if command -v ss >/dev/null 2>&1; then
  for port in 80 443; do
    if ss -H -ltn "sport = :\${port}" 2>/dev/null | grep -q .; then
      warn "Port \${port} is already in use. Public deployments require ports 80 and 443 for managed Traefik."
    fi
  done
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  for port in 80 443; do
    if ! ufw status 2>/dev/null | grep -Eq "^\${port}(/tcp)?[[:space:]]+ALLOW"; then
      warn "UFW is active and does not show an allow rule for TCP port \${port}."
    fi
  done
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  for port in 80 443; do
    if ! firewall-cmd --quiet --query-port="\${port}/tcp"; then
      warn "firewalld is active and does not allow TCP port \${port} in its default zone."
    fi
  done
fi

printf '\n%b%s%b\n' "\${GREEN}" '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' "\${RESET}"
printf '%b  devpush agent installation complete%b\n' "\${BOLD}\${GREEN}" "\${RESET}"
printf '%b%s%b\n\n' "\${GREEN}" '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' "\${RESET}"
printf '  Agent       %s\n' "\${AGENT_VERSION}"
printf '  Service     %s\n' "$(systemctl is-active devpush-agent 2>/dev/null || printf unknown)"
printf '  Config      %s\n' "\${ETC_DIR}/agent.env"
printf '  State       %s\n' "\${STATE_DIR}"
printf '  Auto-update %s\n' "\${AUTO_UPDATE}"
printf '  Install log %s\n' "\${INSTALL_LOG}"
printf '\n%bUseful commands%b\n\n' "\${BOLD}" "\${RESET}"
printf '  Status      sudo systemctl status devpush-agent\n'
printf '  Logs        sudo journalctl -u devpush-agent -f\n'
printf '  Restart     sudo systemctl restart devpush-agent\n'
printf '  Stop        sudo systemctl stop devpush-agent\n'
printf '  Update      sudo %s/update-agent\n' "\${LIB_DIR}"
printf '  Rotate key  sudo %s/devpush-agent credential rotate\n' "\${BIN_DIR}"
printf '\n%bNext steps%b\n\n' "\${BOLD}" "\${RESET}"
printf '  1. Wait for this server to show as connected in devpush.\n'
printf '  2. Allow inbound TCP ports 80 and 443 in the host and provider firewall.\n'
printf '  3. Deploy a project; devpush will start managed Traefik when a public route is needed.\n\n'
printf '%b%s%b\n\n' "\${GREEN}" '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' "\${RESET}"
`

export function buildTokenizedAgentInstallScript({
  autoUpdate,
  baseUrl,
  token,
  traefikEmail,
}: {
  autoUpdate: boolean
  baseUrl: string
  token: string
  traefikEmail?: string
}) {
  const lines = [
    '#!/usr/bin/env bash',
    `export DEVPUSH_BASE_URL=${shellQuote(baseUrl)}`,
    `export DEVPUSH_AGENT_TOKEN=${shellQuote(token)}`,
    `export DEVPUSH_AGENT_AUTO_UPDATE=${shellQuote(String(autoUpdate))}`,
  ]

  if (traefikEmail) {
    lines.push(`export DEVPUSH_TRAEFIK_EMAIL=${shellQuote(traefikEmail)}`)
  }

  return `${lines.join('\n')}\n${AGENT_INSTALL_SCRIPT.replace(
    /^#!\/usr\/bin\/env bash\n/,
    '',
  )}`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
