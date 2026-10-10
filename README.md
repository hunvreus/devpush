# devpush

devpush is a Docker Compose deployment control plane with server-side agents.

The control plane owns users, teams, projects, GitHub integration, deployment
history, deploy logs, and UI workflows. Agents run on user servers, own Docker
Compose and Traefik locally, and connect outbound to the control plane.

`examples/compose-web` contains a known-good Docker Compose app for validating
the first remote deployment against a real server.

## Current status

This repository contains the 1.0 release candidate. Local builds, migrations,
unit tests, and database integration tests are automated; the clean remote VPS
proof remains an explicit release gate in [`TODO.md`](./TODO.md).

> **Compatibility:** 1.0 uses a clean database baseline and is intentionally
> incompatible with pre-1.0 installations. Start 1.0 with an empty database;
> there is no supported in-place upgrade from development builds.

- `app/`: TanStack Start control plane and SQLite data model.
- `agent/`: Go agent for server monitoring, Compose deployments, and backups.
- `docs/`: protocol, feature, and development notes.
- `deploy/`: production Compose configuration.

Current deploy support is intentionally focused: manual deploys and GitHub push
webhooks create queued deployments. Cloudflare sends workspace updates through
hibernating WebSockets; Node uses an in-memory WebSocket broadcaster. Blocked
connections use adaptive HTTP polling. The agent polls for jobs, clones the GitHub
repo with a short-lived installation token, runs Docker Compose on the target
server, incrementally reports deploy logs/events, and posts final status back.
When routes are configured, the agent starts managed Traefik, connects routed
services to a shared proxy network with a generated Compose overlay, and gates
success on container health/readiness checks. Deployment rows snapshot the
resolved project configuration, routes, runtime identity, and encrypted
environment variables; the agent receives that snapshot plus a short-lived
GitHub installation token. Rollback queues a new deployment from a previous
successful deployment snapshot. Runtime logs are collected from active Compose
runtimes through the agent and stored separately from deploy logs.

## Installation

Install app dependencies:

```bash
pnpm install
```

Create the app environment file:

```bash
cp app/.env.example app/.env
```

Generate a Better Auth secret:

```bash
pnpm dlx @better-auth/cli@latest secret
```

Set these values in `app/.env`:

```env
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
DEVPUSH_BASE_URL=http://localhost:7429
# Trust reverse-proxy client IP headers. Keep false for direct exposure.
DEVPUSH_TRUST_PROXY=false
# Optional auth-only override; defaults to DEVPUSH_BASE_URL.
BETTER_AUTH_URL=
# Optional. When blank, the earliest-created user is the installation admin.
DEVPUSH_ADMIN_EMAIL=
DEVPUSH_DATABASE_PATH=.data/devpush.sqlite
DEVPUSH_LOG_DATABASE_PATH=.data/logs.sqlite
DEVPUSH_MONITORING_RETENTION_DAYS=7

EMAIL_FROM="devpush <onboarding@resend.dev>"
RESEND_API_KEY=re_...

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_ID=...
GITHUB_APP_NAME=devpush
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=...

DEVPUSH_AGENT_BINARY_DIR=/absolute/path/to/devpush/bin
DEVPUSH_TRAEFIK_EMAIL=ops@example.com
DEVPUSH_AGENT_AUTO_UPDATE=false
DEVPUSH_BACKUPS_ENABLED=false
VITE_DEVPUSH_BACKUPS_ENABLED=false
DEVPUSH_CRON_SECRET=
DEVPUSH_SECRET_ENCRYPTION_KEY=replace-with-a-separate-long-random-secret
```

Run the interactive setup wizard to configure local development, Cloudflare, or
Docker Compose:

```bash
pnpm configure
```

The wizard writes only ignored, target-specific configuration, generates
application secrets, and can create the GitHub App through GitHub's manifest
flow. Cloudflare resource creation is shown for confirmation before Wrangler is
run, and the application is never deployed by setup. The lower-level
`pnpm run setup:github-app -- --env app/.env` command remains available to replace
only the GitHub App configuration.

`DEVPUSH_ADMIN_EMAIL` selects the installation-wide administrator. If it is
unset, devpush grants that role to the earliest-created user. Team server
management remains separate: only team owners and team admins can add, edit,
disable, re-enroll, or delete that team's servers.

OAuth callbacks:

```text
http://localhost:7429/api/auth/callback/google
http://localhost:7429/api/auth/callback/github
```

GitHub App setup callback:

```text
http://localhost:7429/api/github/install/callback
```

GitHub App webhook URL:

```text
http://localhost:7429/api/github/webhook
```

Sync the database and start the app:

```bash
pnpm --dir app db:migrate
pnpm --dir app dev
```

Maintenance jobs:

```bash
pnpm --dir app cleanup:invites
pnpm --dir app cleanup:users
```

The app uses `http://localhost:7429` as its default local origin. Startup fails
if that port is already in use.

`DEVPUSH_BASE_URL` is the canonical control-plane origin used for generated
links, server installers, and agent communication. `BETTER_AUTH_URL` is an
optional auth-only override and defaults to `DEVPUSH_BASE_URL`. For a Lima VM,
use `http://host.lima.internal:7429` as the base URL while retaining
`http://localhost:7429` for Better Auth in the browser. Restart devpush before
generating an install command. See
[Local setup](./docs/development/local-setup.md#control-plane-origin-and-agent-connectivity).

For the local workflow with the Lima test VM, use the helper scripts:

```bash
pnpm dev:start
pnpm dev:stop
pnpm dev:restart
```

`pnpm dev:start` requires the `devpush-test` Lima VM by
default, syncs the database, and starts the control plane in the background.
Use `DEVPUSH_LIMA_INSTANCE=name` for another VM, or `DEVPUSH_REQUIRE_LIMA=0`
when you only need the web app. Logs are written to `.tmp/devpush-dev.log`.

SMTP is not supported yet; email OTP uses Resend. For production, set
`EMAIL_FROM` to an address on a domain verified in Resend.

For one-command server enrollment, build or provide Linux agent binaries and set
`DEVPUSH_AGENT_BINARY_DIR` to the directory containing
`devpush-agent-linux-amd64` and `devpush-agent-linux-arm64`. The installer
supports apt-, dnf-, and yum-based systemd distributions; provisions Git,
Docker Engine, the Compose plugin, and optional `rclone` when needed; detects
the server architecture; verifies the downloaded binary checksum; creates the
`devpush` system user; writes `/etc/devpush/agent.env`; installs a systemd
service; and starts `devpush-agent`. Installation details are retained under
`/var/log/devpush-agent/`, with `latest.log` pointing to the latest run.

New projects use an exact nip.io host derived from the assigned server, such as
`my-app-167-11-3-44.nip.io`. Local control planes fall back to
`my-app-127-0-0-1.nip.io` until the agent reports an IPv4 address. Generated
aliases use HTTP for private and loopback addresses. Custom project domains are
managed separately in project settings.
`DEVPUSH_TRAEFIK_EMAIL` is passed to installed agents for Let's Encrypt account
registration when HTTPS routes are enabled.

Server install commands contain a time-limited enrollment token. Registration
exchanges it for a dedicated agent credential. If needed, rotate that credential
on the host with `sudo devpush-agent credential rotate`; this does not reinstall
the agent.

Agent updates drain active jobs before restarting. Empty servers can switch
control planes with destination enrollment and rollback; see
[agent maintenance](./docs/development/local-setup.md#agent-maintenance).

## Production control plane

The control plane supports two deployment targets:

- Cloudflare Workers with D1 or remote libSQL/Turso for main state and bulk logs, and R2 for objects.
- A self-hosted Node.js container using local SQLite files or two remote libSQL/Turso databases.

For optional remote database URLs and credentials, see
[remote libSQL setup](./docs/development/local-setup.md#remote-libsql--turso).

The Cloudflare path, including resource provisioning, migrations, agent-binary
publication, validation, and deployment, is documented in
[Cloudflare deployment](./docs/development/cloudflare-deployment.md).

Start either production setup path with `pnpm configure`. It generates
the ignored `app/wrangler.jsonc` plus secret files for Cloudflare, or
`deploy/.env.production` for Docker Compose. It does not deploy or start the
control plane. The tracked `app/wrangler.template.jsonc` is the updateable
source of default Worker settings; setup overlays installation-specific names,
URLs, routes, and resource bindings without asking users to edit tracked files.

For Cloudflare, `pnpm deploy:cloudflare` validates the generated configuration,
applies database migrations, builds and publishes both Linux agent binaries,
and deploys the Worker. The setup wizard offers D1 or remote libSQL/Turso and configures both stores.

### Self-hosted control plane

The production Compose file builds the TanStack Start app and embeds the
Linux agent binary used by the server installer:

Copy the example, fill every blank secret in `deploy/.env.production` with an
independently generated value, then start Compose. `pnpm configure` does this
automatically for the self-hosted setup path.

```bash
cp deploy/.env.production.example deploy/.env.production
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

Set `DEVPUSH_BASE_URL` to the public HTTPS URL of the control plane before
adding servers. A one-shot Compose service applies reviewed SQL migrations before the
app starts. Upgrade,
rollback, health, maintenance, database backup, and agent update procedures are
documented in
[Production operations](./docs/development/production-operations.md). The
production Compose file mounts `app_uploads` at `/repo/app/public/uploads` for
local avatar storage. Configure the `DEVPUSH_STORAGE_*` S3-compatible settings
to use R2 or another object store instead. The migration job publishes the
packaged agent binaries into the configured bucket before the app starts.

Project backup controls are opt-in. Set `DEVPUSH_BACKUPS_ENABLED=true`; local
Vite development must also set `VITE_DEVPUSH_BACKUPS_ENABLED=true`. Production
Compose forwards the client build flag automatically and requires
`DEVPUSH_CRON_SECRET` for maintenance whether project backups are enabled or
not.

## Commands

```bash
pnpm --dir app dev
pnpm --dir app build
pnpm audit:dependencies
pnpm --dir app smoke:worker d1
pnpm --dir app typecheck
pnpm --dir app lint
pnpm --dir app db:generate
pnpm --dir app db:migrate
pnpm configure
pnpm run setup:github-app -- --env app/.env
pnpm smoke:deploy
pnpm smoke:agent
pnpm validate:local
pnpm validate:config
pnpm validate:production
pnpm validate:remote
pnpm validate:remote:proof
pnpm agent:test
pnpm agent:build
pnpm agent:build:linux
pnpm validate:cloudflare
pnpm deploy:cloudflare
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

`pnpm smoke:deploy` uses the local SQLite databases to seed a disposable
user/team/server/project, register the server agent, queue a deployment, claim
it through the agent job protocol, complete it, verify persisted logs, and clean
up the seeded rows. It requires the committed migrations to be applied with `pnpm --dir app db:migrate`.

`pnpm smoke:agent` runs the agent's opt-in Docker smoke tests. It creates
temporary Git repositories with Compose files, runs the real agent deployment
path against local Docker Compose, verifies the pre-deploy command ran through a
mounted volume, verifies an HTTP route through managed Traefik when Docker can
publish port 80, and cleans up the Compose projects.

`pnpm validate:local` runs the local validation gate before a remote VPS attempt:
typecheck, lint, app tests, control-plane deploy smoke, agent tests, local
smoke-mode config validation, and the real Docker/Traefik agent smoke. Set
`DEVPUSH_SKIP_DOCKER_SMOKE=1` only when Docker is unavailable.

`pnpm validate:config` checks the local configuration before a real run:
base URL, optional auth override, OAuth credentials, GitHub App private key,
Resend OTP settings,
and the agent binary path. Use remote mode before adding a real VPS:

```bash
pnpm validate:config -- --env deploy/.env.production --remote
```

`pnpm validate:production` checks the production Compose config, builds the
control-plane image, and verifies that the runtime image contains the Linux
agent binaries, the built server entrypoint, SQL migrations, and standalone
maintenance runners without shipping development dependencies or a TypeScript
runtime.

`pnpm validate:remote` validates the generated server installer against a real
remote host over SSH. It requires `DEVPUSH_BASE_URL`, `DEVPUSH_REMOTE_HOST`,
and `DEVPUSH_INSTALL_COMMAND`; see
[local setup](./docs/development/local-setup.md#remote-validation). Set
`DEVPUSH_FULL_PROOF=1` with `DEVPUSH_PROJECT_URL` after a GitHub-backed deploy
to require the public route and managed Traefik checks. On failure it prints
best-effort remote diagnostics, including agent service status/logs, Docker
containers/networks, and listeners on ports 80/443.

The control-plane and deployed route URLs must use HTTPS unless
`DEVPUSH_ALLOW_INSECURE_BASE_URL=1` is set for a local or private test
network.
Successful remote validation writes a summary to
`.tmp/remote-validation-<timestamp>.md` or `DEVPUSH_REMOTE_SUMMARY_PATH`.

`pnpm validate:remote:proof` runs the full remote proof gate: production config
validation, production image validation, and remote full proof with
`DEVPUSH_FULL_PROOF=1`. It requires `DEVPUSH_PROJECT_URL` in addition to the
remote installer environment, and verifies that the proof env file
`DEVPUSH_BASE_URL` matches the remote proof origin.

For remote server enrollment, run `pnpm agent:build:linux` and set
`DEVPUSH_AGENT_BINARY_DIR` to the generated `bin` directory.

## Docs

- [Architecture](./ARCHITECTURE.md)
- [Local setup](./docs/development/local-setup.md)
- [Hetzner test server](./docs/development/local-setup.md#hetzner-test-server)
- [Cloudflare deployment](./docs/development/cloudflare-deployment.md)
- [TODO](./TODO.md)
- [Docs index](./docs/index.md)
