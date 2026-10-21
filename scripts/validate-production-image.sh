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

# The tracked example deliberately contains blank secrets; use dummy probe values.
if [[ "$env_file" == "deploy/.env.production.example" ]]; then
  export BETTER_AUTH_SECRET=production-image-validation-auth-secret
  export DEVPUSH_SECRET_ENCRYPTION_KEY=production-image-validation-encryption-secret
  export DEVPUSH_CRON_SECRET=production-image-validation-cron-secret
fi

step "Checking production Compose config"
compose --env-file "$env_file" -f deploy/compose.production.yml config >/dev/null

step "Building production app image"
export DEVPUSH_PRODUCTION_IMAGE="$image"
compose --env-file "$env_file" -f deploy/compose.production.yml build app

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
  test -f /repo/app/src/server/db/migrations-sqlite/meta/_journal.json
  test -f /repo/app/src/server/db/migrations-logs/meta/_journal.json
  test -f /repo/app/.maintenance/backup-sqlite.mjs
  test ! -e /repo/node_modules
  test -L /repo/app/node_modules
  test ! -e /repo/app/scripts/migrate.ts
  ! command -v pnpm >/dev/null
  ! command -v tsx >/dev/null
  node --check /repo/app/.maintenance/migrate.mjs
  node --check /repo/app/.maintenance/sync-agent-binaries.mjs
  node /repo/app/.maintenance/sync-agent-binaries.mjs
'

missing_database_output="$(docker run --rm "$image" node .maintenance/migrate.mjs 2>&1 || true)"
if ! grep -q 'DEVPUSH_DATABASE_PATH is required in production' <<<"$missing_database_output"; then
  echo "Production migration runner did not reject a missing DEVPUSH_DATABASE_PATH." >&2
  exit 1
fi

step "Exercising production migrations and health check"
probe_id="devpush-production-probe-${RANDOM:-0}-$$"
probe_network="${probe_id}-net"
probe_volume="${probe_id}-data"
probe_store="${probe_id}-store"
probe_app="${probe_id}-app"
probe_dir="$(mktemp -d)"

# Keep real operator configuration out of the disposable Compose probe.
probe_compose() (
  for name in "${!DEVPUSH_@}" "${!BETTER_AUTH_@}" "${!GITHUB_APP_@}" "${!GOOGLE_@}" EMAIL_FROM RESEND_API_KEY; do
    unset "$name"
  done
  export DEVPUSH_PRODUCTION_IMAGE="$image"
  compose -p "$probe_id" --env-file "$probe_dir/compose.env" -f deploy/compose.production.yml "$@"
)
cat > "$probe_dir/compose.env" <<'EOF'
BETTER_AUTH_SECRET=production-image-validation-auth-secret
DEVPUSH_SECRET_ENCRYPTION_KEY=production-image-validation-encryption-secret
DEVPUSH_CRON_SECRET=production-image-validation-cron-secret
DEVPUSH_BASE_URL=http://localhost:3000
DEVPUSH_HTTP_PORT=127.0.0.1:0
DEVPUSH_SIGN_IN_MESSAGE="Compose probe: sign in with your work email."
EOF

cleanup_probe() {
  probe_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$probe_dir"
  docker rm -f "$probe_app" "$probe_store" >/dev/null 2>&1 || true
  docker volume rm "$probe_volume" >/dev/null 2>&1 || true
  docker network rm "$probe_network" >/dev/null 2>&1 || true
}
trap cleanup_probe EXIT INT TERM

docker network create "$probe_network" >/dev/null
docker volume create "$probe_volume" >/dev/null

docker run -d \
  --name "$probe_store" \
  --network "$probe_network" \
  --network-alias object-store \
  --network-alias devpush.object-store \
  "$image" \
  node -e "const fs=require('node:fs');require('node:http').createServer((request,response)=>{let size=0;request.on('data',chunk=>{size+=chunk.length});request.on('end',()=>{const signed=request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')?'signed':'unsigned';if(request.method==='PUT')fs.appendFileSync('/tmp/requests',request.method+' '+request.url+' '+size+' '+signed+'\\n');response.statusCode=200;response.end()})}).listen(9000,'0.0.0.0')" >/dev/null

docker run --rm \
  --network "$probe_network" \
  -v "$probe_volume:/app/storage" \
  -e DEVPUSH_DATABASE_PATH=/app/storage/devpush.sqlite \
  -e DEVPUSH_LOG_DATABASE_PATH=/app/storage/logs.sqlite \
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
  -v "$probe_volume:/app/storage" \
  -e DEVPUSH_DATABASE_PATH=/app/storage/devpush.sqlite \
  -e DEVPUSH_LOG_DATABASE_PATH=/app/storage/logs.sqlite \
  -e BETTER_AUTH_SECRET=production-image-validation-secret \
  -e DEVPUSH_CRON_SECRET=production-image-validation-cron-secret \
  -e DEVPUSH_BASE_URL=http://localhost:3000 \
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

step "Checking login and scheduled maintenance"
docker exec "$probe_app" curl --fail --silent http://127.0.0.1:3000/auth/login >/dev/null
docker exec "$probe_app" curl --fail --silent --request POST \
  --header 'Authorization: Bearer production-image-validation-cron-secret' \
  http://127.0.0.1:3000/api/cron/maintenance >/dev/null

step "Checking online backups and restored snapshots"
docker run --rm \
  -v "$probe_volume:/app/storage" \
  -e DEVPUSH_DATABASE_PATH=/app/storage/devpush.sqlite \
  -e DEVPUSH_LOG_DATABASE_PATH=/app/storage/logs.sqlite \
  -e DEVPUSH_DB_BACKUP_DIR=/app/storage/backups \
  "$image" node .maintenance/backup-sqlite.mjs
docker run --rm -v "$probe_volume:/app/storage" "$image" node --input-type=module -e '
  import { createRequire } from "node:module";
  import { readdirSync } from "node:fs";
  const require = createRequire("/repo/app/.output/server/index.mjs");
  const Sqlite = require("better-sqlite3");
  const files = readdirSync("/app/storage/backups");
  if (files.length !== 2) throw new Error("Expected two snapshots");
  for (const file of files) {
    const db = new Sqlite("/app/storage/backups/" + file, { readonly: true });
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Snapshot integrity failure");
    if (!db.prepare("select count(*) as n from sqlite_master where type = ?").get("table").n) throw new Error("Missing migrated tables");
    db.close();
  }
'

step "Checking production Compose startup and sign-in notice"
probe_compose up -d --no-build --wait --wait-timeout 90
compose_app="$(probe_compose ps -q app)"
docker exec "$compose_app" sh -ec '
  curl --fail --silent http://127.0.0.1:3000/auth/login | grep -Fq "$DEVPUSH_SIGN_IN_MESSAGE"
  curl --fail --silent --request POST --header "Authorization: Bearer $DEVPUSH_CRON_SECRET" http://127.0.0.1:3000/api/cron/maintenance >/dev/null
'

cleanup_probe
trap - EXIT INT TERM

image_size="$(docker image inspect "$image" --format '{{.Size}}')"

cat <<EOF

Production image validation passed.

Image: $image
Uncompressed image size: $image_size bytes
EOF
