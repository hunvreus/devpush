#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Validate the production control-plane image before a remote VPS run.

This checks the production Compose file, builds the app image, and verifies that
the runtime image contains:

- the bundled Linux devpush-agent binary used by the server installer
- the standalone migration and agent-publication runners, plus SQL migrations
- the built TanStack Start server entrypoint
- no development dependency tree or TypeScript runtime

Optional environment:
  DEVPUSH_PRODUCTION_IMAGE  Image tag to build, default: devpush-app:local
  DEVPUSH_PRODUCTION_ENV    Env file for Compose config, default: deploy/.env.production.example

Example:
  pnpm validate:production
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

image="${DEVPUSH_PRODUCTION_IMAGE:-devpush-app:local}"
env_file="${DEVPUSH_PRODUCTION_ENV:-deploy/.env.production.example}"

step() {
  printf '\n==> %s\n' "$1"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Docker Compose is required." >&2
  exit 1
}

step "Checking production Compose config"
compose --env-file "$env_file" -f deploy/compose.production.yml config >/dev/null

step "Building production app image"
docker build -f deploy/Dockerfile.app -t "$image" .

step "Checking production runtime image"
docker run --rm "$image" sh -lc '
  set -euo pipefail
  test -x /repo/bin/devpush-agent-linux-amd64
  test -x /repo/bin/devpush-agent-linux-arm64
  case "$(uname -m)" in
    x86_64) /repo/bin/devpush-agent-linux-amd64 --help >/dev/null ;;
    aarch64) /repo/bin/devpush-agent-linux-arm64 --help >/dev/null ;;
    *) echo "Unsupported validation architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  test -f /repo/app/.output/server/index.mjs
  test -f /repo/app/.maintenance/migrate.mjs
  test -f /repo/app/.maintenance/migrate.mjs.map
  test -f /repo/app/.maintenance/sync-agent-binaries.mjs
  test -f /repo/app/.maintenance/sync-agent-binaries.mjs.map
  test -f /repo/app/src/server/db/migrations/meta/_journal.json
  test ! -e /repo/node_modules
  test ! -e /repo/app/node_modules
  test ! -e /repo/app/scripts/migrate.ts
  ! command -v pnpm >/dev/null
  ! command -v tsx >/dev/null
  node --check /repo/app/.maintenance/migrate.mjs
  node --check /repo/app/.maintenance/sync-agent-binaries.mjs
  node /repo/app/.maintenance/sync-agent-binaries.mjs
'

missing_database_output="$(docker run --rm "$image" node .maintenance/migrate.mjs 2>&1 || true)"
if ! grep -q 'DATABASE_URL is required in production' <<<"$missing_database_output"; then
  echo "Production migration runner did not reject a missing DATABASE_URL." >&2
  exit 1
fi

step "Exercising production migrations and health check"
probe_id="devpush-production-probe-${RANDOM:-0}-$$"
probe_network="${probe_id}-net"
probe_database="${probe_id}-db"
probe_store="${probe_id}-store"
probe_app="${probe_id}-app"

cleanup_probe() {
  docker rm -f "$probe_app" "$probe_store" "$probe_database" >/dev/null 2>&1 || true
  docker network rm "$probe_network" >/dev/null 2>&1 || true
}
trap cleanup_probe EXIT INT TERM

docker network create "$probe_network" >/dev/null
docker run -d \
  --name "$probe_database" \
  --network "$probe_network" \
  -e POSTGRES_DB=devpush \
  -e POSTGRES_USER=devpush \
  -e POSTGRES_PASSWORD=devpush \
  postgres:17-alpine >/dev/null

docker run -d \
  --name "$probe_store" \
  --network "$probe_network" \
  --network-alias object-store \
  --network-alias devpush.object-store \
  "$image" \
  node -e "const fs=require('node:fs');require('node:http').createServer((request,response)=>{let size=0;request.on('data',chunk=>{size+=chunk.length});request.on('end',()=>{const signed=request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')?'signed':'unsigned';if(request.method==='PUT')fs.appendFileSync('/tmp/requests',request.method+' '+request.url+' '+size+' '+signed+'\\n');response.statusCode=200;response.end()})}).listen(9000,'0.0.0.0')" >/dev/null

database_ready=false
for _ in $(seq 1 30); do
  if docker exec "$probe_database" pg_isready -U devpush -d devpush >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done
if [[ "$database_ready" != "true" ]]; then
  docker logs "$probe_database" >&2
  echo "Production validation database did not become ready." >&2
  exit 1
fi

database_url="postgres://devpush:devpush@${probe_database}:5432/devpush"
docker run --rm \
  --network "$probe_network" \
  -e DATABASE_URL="$database_url" \
  "$image" \
  node --enable-source-maps /repo/app/.maintenance/migrate.mjs

store_ready=false
for _ in $(seq 1 30); do
  if docker exec "$probe_store" wget -qO- http://127.0.0.1:9000 >/dev/null 2>&1; then
    store_ready=true
    break
  fi
  sleep 1
done
if [[ "$store_ready" != "true" ]]; then
  docker logs "$probe_store" >&2
  echo "Production validation object store did not become ready." >&2
  exit 1
fi

docker run --rm \
  --network "$probe_network" \
  -e DEVPUSH_STORAGE_ENDPOINT=http://object-store:9000 \
  -e DEVPUSH_STORAGE_REGION=auto \
  -e DEVPUSH_STORAGE_BUCKET=devpush \
  -e DEVPUSH_STORAGE_ACCESS_KEY_ID=validation \
  -e DEVPUSH_STORAGE_SECRET_ACCESS_KEY=validation-secret \
  "$image" \
  node --enable-source-maps /repo/app/.maintenance/sync-agent-binaries.mjs

docker exec "$probe_store" sh -ec '
  test "$(wc -l < /tmp/requests)" -eq 2
  grep -q "devpush-agent-linux-amd64" /tmp/requests
  grep -q "devpush-agent-linux-arm64" /tmp/requests
  awk "\$1 != \"PUT\" || \$3 <= 0 || \$4 != \"signed\" { exit 1 }" /tmp/requests
'

docker run -d \
  --name "$probe_app" \
  --network "$probe_network" \
  -e DATABASE_URL="$database_url" \
  -e BETTER_AUTH_SECRET=production-image-validation-secret \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  "$image" >/dev/null

app_ready=false
for _ in $(seq 1 60); do
  if docker exec "$probe_app" wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"status":"ok"'; then
    app_ready=true
    break
  fi
  if [[ "$(docker inspect "$probe_app" --format '{{.State.Running}}')" != "true" ]]; then
    break
  fi
  sleep 1
done
if [[ "$app_ready" != "true" ]]; then
  docker logs "$probe_app" >&2
  echo "Production image health check failed." >&2
  exit 1
fi

cleanup_probe
trap - EXIT INT TERM

image_size="$(docker image inspect "$image" --format '{{.Size}}')"

cat <<EOF

Production image validation passed.

Image: $image
Uncompressed image size: $image_size bytes
EOF
