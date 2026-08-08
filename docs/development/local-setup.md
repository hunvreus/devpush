# Local setup

## Requirements

- Node.js 22 or newer.
- pnpm 10.17 or newer.
- Go 1.25 or newer.
- Docker for local Postgres.

## Control plane

```bash
cp app/.env.example app/.env
pnpm --dir app install
docker-compose -f deploy/compose.yml up -d
pnpm --dir app db:push
pnpm --dir app dev
```

The app runs at the fixed local OAuth origin `http://localhost:7429`. Startup
fails if that port is already in use.

For normal local MVP testing with the Lima agent VM:

```bash
pnpm dev:start
pnpm dev:stop
pnpm dev:restart
```

`pnpm dev:start` starts local Postgres, requires the `devpush-test` Lima VM by
default, syncs the database, and starts the control plane in the background.
Use `DEVPUSH_LIMA_INSTANCE=name` for another VM, or `DEVPUSH_REQUIRE_LIMA=0`
when testing only the web app. The dev server log is `.tmp/devpush-dev.log`.

## Production control plane

The MVP production Compose file builds the app and the Linux agent binary into
one control-plane image:

```bash
cp deploy/.env.production.example deploy/.env.production
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

If Compose is installed as the standalone v2 binary on your host, run the same
command with `docker-compose`.

Set `BETTER_AUTH_URL` in `deploy/.env.production` to the public HTTPS URL before
adding servers. The server installer uses that URL to register agents and
download `/api/install/agent/binary`.

The app container runs reviewed SQL migrations with `pnpm --dir app db:migrate`
before starting the Node server. It never runs `drizzle-kit push` in
production. It also mounts the `app_uploads` named volume at
`/repo/app/public/uploads` so uploaded avatars are not lost when the app
container is recreated.

## Auth

Generate a Better Auth secret:

```bash
pnpm dlx @better-auth/cli@latest secret
```

Set these values in `app/.env`:

```bash
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:7429
```

### Email OTP with Resend

Required:

```bash
EMAIL_FROM="devpush <noreply@example.com>"
RESEND_API_KEY=re_...
```

SMTP is not supported yet.

## Database

After changing Drizzle schemas:

```bash
pnpm --dir app db:generate
```

For local schema sync:

```bash
pnpm --dir app db:push
```

`db:push` is for disposable local databases and rapid schema iteration only.
Commit generated migrations and apply them with `pnpm --dir app db:migrate` for
production-compatible validation.

The local Compose database is exposed on host port `7543` to avoid conflicts
with local Postgres or SSH tunnels on `5432`.

For DB-backed service integration tests, use a disposable database:

```bash
pnpm --dir app exec node - <<'NODE'
const { Client } = require('pg')
const dbName = 'devpush_integration'
const c = new Client({
  connectionString: 'postgres://devpush:devpush@localhost:7543/postgres',
})
async function main() {
  await c.connect()
  await c.query(`drop database if exists ${dbName} with (force)`)
  await c.query(`create database ${dbName}`)
  await c.end()
}
main().catch(async (error) => {
  console.error(error)
  try {
    await c.end()
  } catch {}
  process.exit(1)
})
NODE
DATABASE_URL=postgres://devpush:devpush@localhost:7543/devpush_integration pnpm --dir app db:push
DATABASE_URL=postgres://devpush:devpush@localhost:7543/devpush_integration pnpm --dir app test:integration
```

## Smoke checks

After local Postgres is running and the schema is synced:

```bash
pnpm smoke:deploy
pnpm smoke:agent
pnpm validate:local
pnpm validate:config
pnpm validate:production
```

This seeds disposable data, registers a server, queues a deployment, claims it
through the agent job protocol with a fake GitHub token, completes it, verifies
deployment logs were stored, and cleans up the seeded rows. It does not run
Docker Compose on a target server; use it to validate the control-plane job
lifecycle before testing a real host.

`pnpm smoke:agent` runs the agent's real Docker Compose deployment path against
local Docker. It creates a temporary Git repo, deploys it with Compose, runs the
release command, verifies the mounted output, and tears the Compose project
down.

The app test suite also executes the generated agent installer in a staged
filesystem root. That verifies the installer writes `agent.env`, installs the
agent binary, generates the systemd unit, and calls `systemctl enable --now`
without touching the real host filesystem.

`pnpm validate:local` runs the local MVP gate before a remote VPS attempt:
TypeScript, linting, app tests, the control-plane deploy lifecycle smoke, agent
tests, smoke-mode config validation, and the real Docker/Traefik agent smoke.
Set `DEVPUSH_SKIP_DOCKER_SMOKE=1` only when Docker is unavailable.

Before validating a real remote server, run the stricter config check:

```bash
pnpm validate:config -- --env deploy/.env.production --remote
```

That verifies the public auth URL, OAuth credentials, GitHub App private key,
Resend settings and the packaged agent binary directory. Remote validation
rejects localhost/private control-plane hosts and paths on `BETTER_AUTH_URL`.

Then validate the production image:

```bash
pnpm validate:production
```

This checks the production Compose config, builds the app image, and verifies
that the runtime image contains the Linux agent binary, the built server
entrypoint, and the migration tooling.

## Remote MVP validation

Use this after the control plane is reachable from the internet and
`DEVPUSH_AGENT_BINARY_DIR` points to Linux agent binaries.

Create a server in devpush, copy the generated install command, then run:

```bash
DEVPUSH_SERVER_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
pnpm validate:remote
```

`DEVPUSH_SERVER_URL` and `DEVPUSH_PROJECT_URL` must use HTTPS by default. Set
`DEVPUSH_ALLOW_INSECURE_SERVER_URL=1` only for local or private test networks.

The script checks:

- `/api/install/agent` and `/api/install/agent/binary` are reachable.
- SSH access to the remote server works.
- The generated install command completes.
- `/usr/local/bin/devpush-agent` exists.
- `/etc/devpush/agent.env` exists.
- `devpush-agent` is active in systemd.
- `devpush-agent` logs show registration or heartbeat activity after the remote
  validation run started.
- Docker and Docker Compose are available to both root and the `devpush` agent
  user.
- Recent `devpush-agent` systemd logs are readable for debugging.
- Optionally, the managed Traefik and Docker socket proxy containers are
  running.
- Optionally, the deployed public route responds within a retry window.
- A success summary is written to
  `.tmp/remote-mvp-validation-<timestamp>.md`, or to
  `DEVPUSH_REMOTE_SUMMARY_PATH` when set.

If a remote validation step fails, the script prints best-effort diagnostics:
remote system information, `devpush-agent` systemd status and logs, Docker
containers, Docker networks, and listeners on ports 80/443. Set
`DEVPUSH_REMOTE_DIAGNOSTICS=0` to disable this.

The success summary records the checked URLs, mode flags, remote host, and
timestamps. It does not record the generated install command because that
command contains the server enrollment token.

After that, complete the product flow in the UI:

1. Confirm the server is shown as connected.
2. Create a project from a GitHub repo with a Compose file.
3. For the bundled example app, copy `examples/compose-web` into a GitHub repo
   that the GitHub App can access.
4. Set Compose file path to `compose.yml`.
5. Set the public route service to `web` and port to `3000`.
6. Set readiness path to `/health`.
7. Leave release command empty.
8. Trigger a deploy.
9. Confirm the deployment reaches `Succeeded`.
10. Visit or curl the configured public route.

You can add a deployed route check to the same command:

```bash
DEVPUSH_SERVER_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
DEVPUSH_PROJECT_URL=https://my-app.example.com \
DEVPUSH_PROJECT_URL_TIMEOUT=180 \
pnpm validate:remote
```

For the full remote MVP proof, require the deployed route and managed Traefik
checks:

```bash
DEVPUSH_SERVER_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
DEVPUSH_PROJECT_URL=https://my-app.example.com \
DEVPUSH_FULL_PROOF=1 \
pnpm validate:remote
```

`DEVPUSH_FULL_PROOF=1` forces `DEVPUSH_VALIDATE_TRAEFIK=1` and
`DEVPUSH_REQUIRE_PROJECT_URL=1`. For install-only validation, leave
`DEVPUSH_FULL_PROOF` unset. Traefik reads Docker metadata through the managed
`devpush-docker-socket-proxy` container instead of mounting the Docker socket
directly.

To run every remote proof gate in order, use:

```bash
DEVPUSH_SERVER_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
DEVPUSH_PROJECT_URL=https://my-app.example.com \
pnpm validate:remote:proof
```

That command requires `deploy/.env.production` by default, verifies that
`BETTER_AUTH_URL` in that env file matches `DEVPUSH_SERVER_URL`, then runs remote
config validation, production image validation, and `pnpm validate:remote` with
`DEVPUSH_FULL_PROOF=1`.

### Google OAuth

Required:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Callback:

```text
http://localhost:7429/api/auth/callback/google
```

### GitHub OAuth

Required:

```bash
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

Callback:

```text
http://localhost:7429/api/auth/callback/github
```

### GitHub App installation

Required for repository selection and project creation:

```bash
GITHUB_APP_ID=...
GITHUB_APP_NAME=devpush
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=...
```

Configure the GitHub App with repository **Contents: Read-only** permission and
subscribe it to **Push** events. Enable webhooks, use the same webhook secret as
`GITHUB_APP_WEBHOOK_SECRET`, generate a private key for
`GITHUB_APP_PRIVATE_KEY`, and enable OAuth for the callback below. GitHub's
[registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app)
describes the corresponding app settings. Automated app provisioning is not yet
implemented; the required manifest/helper remains tracked in `TODO.md`.

Setup callback:

```text
http://localhost:7429/api/github/install/callback
```

Webhook URL:

```text
http://localhost:7429/api/github/webhook
```

Replace `http://localhost:7429` with the configured `BETTER_AUTH_URL` origin in
production.

## Agent

```bash
pnpm agent:test
pnpm agent:build
```

For a Linux target server, provide a Linux binary to the control plane:

```bash
pnpm agent:build:linux
```

Then set this in `app/.env`:

```bash
DEVPUSH_AGENT_BINARY_DIR=/absolute/path/to/devpush/bin
DEVPUSH_TRAEFIK_EMAIL=ops@example.com
```

The server install command shown in the UI detects Linux `amd64` or `arm64`,
downloads the matching binary from `/api/install/agent/binary`, creates the
`devpush` system user, writes `/etc/devpush/agent.env`, installs a systemd
service, and starts the agent.

New projects default to an exact nip.io host derived from the assigned server,
such as `my-app-167-11-3-44.nip.io`. A local control plane uses
`127-0-0-1.nip.io` until the agent reports an IPv4 address. Generated aliases
are persisted, and private or loopback aliases use HTTP.

For a Lima-backed local server, add a custom domain such as
`my-app.localhost` in the project Domains settings, assign it to the desired
environment, and disable HTTPS. Names under `.localhost` resolve to the local
machine, and Lima forwards Traefik's exposed ports, so the route is available at
`http://my-app.localhost` without DNS or `/etc/hosts` changes.

`DEVPUSH_TRAEFIK_EMAIL` is optional but recommended for HTTPS routes. The
installer writes it to the agent environment so managed Traefik can register
Let's Encrypt certificates.

Run the agent manually for local protocol testing:

```bash
DEVPUSH_SERVER_URL=http://localhost:7429 \
DEVPUSH_AGENT_TOKEN=dev-token \
go run ./agent/cmd/devpush-agent -config /tmp/missing-devpush-agent.env
```
