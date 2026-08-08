export const AGENT_INSTALL_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

if [ -z "\${DEVPUSH_SERVER_URL:-}" ]; then
  echo "DEVPUSH_SERVER_URL is required." >&2
  exit 1
fi

if [ -z "\${DEVPUSH_AGENT_TOKEN:-}" ]; then
  echo "DEVPUSH_AGENT_TOKEN is required." >&2
  exit 1
fi

AGENT_USER="\${DEVPUSH_AGENT_USER:-devpush}"
INSTALL_ROOT="\${DEVPUSH_INSTALL_ROOT:-}"
BINARY_URL="\${DEVPUSH_AGENT_BINARY_URL:-}"
AUTO_UPDATE="\${DEVPUSH_AGENT_AUTO_UPDATE:-false}"

detect_os() {
  case "$(uname -s)" in
    Linux) printf "linux" ;;
    *)
      echo "Unsupported OS: $(uname -s). devpush agents currently require Linux." >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) printf "amd64" ;;
    aarch64 | arm64) printf "arm64" ;;
    *)
      echo "Unsupported CPU architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

if [ -z "\${BINARY_URL}" ]; then
  BINARY_OS="$(detect_os)"
  BINARY_ARCH="$(detect_arch)"
  BINARY_URL="\${DEVPUSH_SERVER_URL%/}/api/install/agent/binary?os=\${BINARY_OS}&arch=\${BINARY_ARCH}"
fi

target_path() {
  printf "%s%s" "\${INSTALL_ROOT}" "$1"
}

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
  echo "curl is required." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y git ca-certificates
  else
    echo "git is required. Install git and run this command again." >&2
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  else
    echo "Docker is required. Install Docker and run this command again." >&2
    exit 1
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker-compose-plugin
  fi
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "Docker Compose is required. Install the Docker Compose plugin or docker-compose and run this command again." >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y rclone
  fi
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "Warning: rclone is required for remote backups. Install rclone on this server or keep remote backups disabled." >&2
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

tmp_binary="$(mktemp)"
trap 'rm -f "\${tmp_binary}"' EXIT

echo "Downloading devpush-agent from \${BINARY_URL}"
curl -fsSL "\${BINARY_URL}" -o "\${tmp_binary}"
install -m 0755 "\${tmp_binary}" "\${BIN_DIR}/devpush-agent"

cat >"\${ETC_DIR}/agent.env" <<EOF
DEVPUSH_SERVER_URL="\${DEVPUSH_SERVER_URL}"
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
base="\${DEVPUSH_SERVER_URL%/}/api/install/agent"
tmp="$(mktemp -d)"
trap 'rm -rf "\${tmp}"' EXIT
curl -fsSL "\${base}/binary?os=\${os}&arch=\${arch}" -o "\${tmp}/devpush-agent-linux-\${arch}"
curl -fsSL "\${base}/checksum?os=\${os}&arch=\${arch}" -o "\${tmp}/checksum"
(cd "\${tmp}" && sha256sum -c checksum)
if cmp -s "\${tmp}/devpush-agent-linux-\${arch}" /usr/local/bin/devpush-agent; then
  echo "devpush agent is already current."
  exit 0
fi
install -m 0755 "\${tmp}/devpush-agent-linux-\${arch}" /usr/local/bin/devpush-agent
systemctl restart devpush-agent
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

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required to start devpush-agent automatically." >&2
  exit 1
fi

systemctl daemon-reload
systemctl enable devpush-agent
systemctl restart devpush-agent

if [ "\${AUTO_UPDATE}" = "true" ]; then
  systemctl enable --now devpush-agent-update.timer
else
  systemctl disable --now devpush-agent-update.timer >/dev/null 2>&1 || true
fi

echo "devpush agent installed and started."
echo "Update manually with: sudo \${LIB_DIR}/update-agent"
echo "Rotate credentials with: sudo \${BIN_DIR}/devpush-agent credential rotate"
`
