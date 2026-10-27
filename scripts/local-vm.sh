#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VM=devpush-test
command="${1:-help}"
if [[ "$command" == "--" ]]; then shift; command="${1:-help}"; fi

usage() {
  cat <<'USAGE'
Local devpush VM:
  pnpm vm:setup          Create/start the VM with Docker and a reachable local IP.
  pnpm vm:install URL    Enroll this VM using a generated installer, pinning its IP.
  pnpm vm:test           Set up the VM and run real Compose/Traefik tests directly.
  pnpm vm:stop           Stop the VM, keeping its disk.
  pnpm vm:destroy       Delete the dedicated test VM and all its data.
Requires macOS and Lima; tests also require Go on the host. VM name: devpush-test.
USAGE
}
if [[ "$command" == install ]]; then
  [[ $# -eq 2 ]] || { usage >&2; exit 2; }
else
  [[ $# -le 1 ]] || { usage >&2; exit 2; }
fi
guest() { limactl shell "$VM" -- "$@"; }
status() { limactl list --format '{{.Name}} {{.Status}}' | awk -v name="$VM" '$1 == name {print $2}'; }
setup() {
  [[ "$(uname -s)" == Darwin ]] || { echo 'This local VM setup uses macOS Lima vzNAT networking.' >&2; exit 1; }
  local current network
  current="$(status)"
  if [[ -z "$current" ]]; then
    limactl create --tty=false --name "$VM" "$ROOT/scripts/local-vm.yaml"
  fi
  if [[ "$current" != Running ]]; then limactl start --tty=false "$VM"; fi
  guest test -f /etc/devpush-test-vm
  # Check the marker before changing an existing VM's networking.
  network="$(limactl list --json | node --input-type=module -e '
    let raw = ""; for await (const chunk of process.stdin) raw += chunk;
    const vm = raw.trim().split("\n").filter(Boolean).map(JSON.parse).find(vm => vm.name === "devpush-test");
    if (!vm || vm.vmType !== "vz") process.exit(1);
    console.log((vm.config?.networks ?? []).some(network => network.vzNAT) ? "ready" : "missing");
  ')" || { echo 'The test VM must use the vz driver. Recreate it with vm:destroy then vm:setup.' >&2; exit 1; }
  if [[ "$network" != ready ]]; then
    limactl stop "$VM"
    limactl edit --tty=false --network=vzNAT "$VM"
    limactl start --tty=false "$VM"
  fi
  guest sudo docker info >/dev/null
  guest sudo docker compose version
  echo 'Local VM IPv4:'
  guest ip -4 -o addr show dev lima0 scope global | awk '{sub(/\/.*/, "", $4); print $4}'
}

case "$command" in
  help|--help|-h) usage; exit 0 ;;
  setup) setup; exit 0 ;;
  install)
    installer="${2:-}"
    [[ "$installer" == http://* || "$installer" == https://* ]] || { echo 'Pass the generated installer URL from devpush.' >&2; exit 2; }
    setup
    address="$(guest ip -4 -o addr show dev lima0 scope global | awk '{sub(/\/.*/, "", $4); print $4; exit}')"
    [[ -n "$address" ]] || { echo 'VM has no reachable IPv4 address.' >&2; exit 1; }
    guest bash -s -- "$installer" "$address" <<'INSTALL'
set -euo pipefail
script="$(mktemp)"
trap 'rm -f "$script"' EXIT
curl -fsSL -o "$script" -- "$1"
sudo bash "$script" --address "$2"
INSTALL
    exit 0 ;;

  stop) [[ -z "$(status)" ]] || limactl stop "$VM"; exit 0 ;;
  destroy)
    [[ -n "$(status)" ]] || { echo "$VM does not exist."; exit 0; }
    # Validate ownership before deleting a VM with this name.
    [[ "$(status)" == Running ]] || limactl start --tty=false "$VM"
    guest test -f /etc/devpush-test-vm
    limactl stop "$VM"
    limactl delete --tty=false "$VM"
    exit 0 ;;
  test) ;;
  *) usage >&2; exit 2 ;;
esac

command -v go >/dev/null
setup
# An enrolled VM belongs to a different testing flow; don't alter its ingress.
guest bash -s <<'CHECK'
set -euo pipefail
if systemctl is-active --quiet devpush-agent || sudo docker inspect devpush-traefik >/dev/null 2>&1 || sudo docker inspect devpush-docker-socket-proxy >/dev/null 2>&1; then
  echo 'This VM already has an agent or ingress. Use vm:destroy then vm:test for a clean test VM.' >&2
  exit 1
fi
CHECK
case "$(guest uname -m)" in aarch64) arch=arm64 ;; x86_64) arch=amd64 ;; *) echo 'Unsupported VM architecture.' >&2; exit 1 ;; esac
mkdir -p "$ROOT/.tmp"
temporary="$(mktemp -d "$ROOT/.tmp/vm-test.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
cd "$ROOT"
GOOS=linux GOARCH="$arch" CGO_ENABLED=0 GOCACHE="$ROOT/.tmp/go-build-cache" \
  go test -c -o "$temporary/agent.test" ./agent/internal/agent
# Lima mounts the host home read-only; copy the binary to writable guest storage.
guest sudo bash -s -- "$temporary/agent.test" <<'TEST' | tee "$temporary/results.log"
set -euo pipefail
work="$(mktemp -d /tmp/devpush-test.XXXXXX)"
cleanup() {
  docker rm -f devpush-docker-socket-proxy >/dev/null 2>&1 || true
  docker network rm devpush-docker-api devpush-proxy >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
cp "$1" "$work/agent.test"
mkdir -p "$work/internal/agent"
cd "$work/internal/agent"
DEVPUSH_RUN_DOCKER_SMOKE=1 "$work/agent.test" -test.v -test.timeout=8m \
  '-test.run=^TestRunDeploymentJob(RunsRealDockerCompose|RoutesThroughRealTraefik)$'
TEST
if grep -q -- '--- SKIP:' "$temporary/results.log"; then echo 'Tests must not be skipped.' >&2; exit 1; fi
for test in RunsRealDockerCompose RoutesThroughRealTraefik; do
  grep -q -- "--- PASS: TestRunDeploymentJob$test" "$temporary/results.log"
done
echo "VM tests passed. $VM remains running; use pnpm vm:stop or pnpm vm:destroy."
