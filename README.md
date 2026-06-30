# devpush

devpush is being rebuilt as a Docker Compose deployment control plane with
server-side agents.

The control plane owns users, teams, projects, GitHub integration, deployment
history, deploy logs, and UI workflows. Agents run on user servers, own Docker
Compose and Traefik locally, and connect outbound to the control plane.

The previous FastAPI implementation lives in `legacy/` as reference material.
`examples/compose-web` contains a known-good Docker Compose app for validating
the first remote deployment against a real server.

## Current status

This branch contains the MVP scaffold:

- `app/`: TanStack Start control plane scaffold.
- `agent/`: Go agent for server registration, heartbeats, and basic Compose deploy jobs.
- `docs/`: protocol, feature, and development notes.
- `deploy/`: local and production Compose files.
- `legacy/`: old implementation.

Current deploy support is intentionally narrow: manual deploys and GitHub push
webhooks create queued deployments. The agent polls for jobs, clones the GitHub
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
pnpm --dir app install
```

Start local Postgres:

```bash
docker-compose -f deploy/compose.yml up -d
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
BETTER_AUTH_URL=http://localhost:7429
DATABASE_URL=postgres://devpush:devpush@localhost:7543/devpush

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
DEVPUSH_DEFAULT_APP_DOMAIN=devpush.app
```

The GitHub OAuth credentials should come from the GitHub App OAuth settings.

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
pnpm --dir app db:push
pnpm --dir app dev
```

Maintenance jobs:

```bash
pnpm --dir app cleanup:invites
pnpm --dir app cleanup:users
```

The app runs at the fixed local OAuth origin `http://localhost:7429`. Startup
fails if that port is already in use.

For the local MVP workflow with the Lima test VM, use the helper scripts:

```bash
pnpm dev:start
pnpm dev:stop
pnpm dev:restart
```

`pnpm dev:start` starts local Postgres, requires the `devpush-test` Lima VM by
default, syncs the database, and starts the control plane in the background.
Use `DEVPUSH_LIMA_INSTANCE=name` for another VM, or `DEVPUSH_REQUIRE_LIMA=0`
when you only need the web app. Logs are written to `.tmp/devpush-dev.log`.

SMTP is not supported yet; email OTP uses Resend. For production, set
`EMAIL_FROM` to an address on a domain verified in Resend.

For one-command server enrollment, build or provide Linux agent binaries and set
`DEVPUSH_AGENT_BINARY_DIR` to the directory containing
`devpush-agent-linux-amd64` and `devpush-agent-linux-arm64`. The installer
detects the server architecture, downloads the matching binary from the control
plane, creates the `devpush` system user, writes `/etc/devpush/agent.env`,
installs a systemd service, and starts `devpush-agent`.

When the selected server reports a public IPv4 address, new projects default to
an exact nip.io host such as `my-app.167-11-3-44.nip.io`. Otherwise,
`DEVPUSH_DEFAULT_APP_DOMAIN` is used for new project route defaults. Hosted
devpush can use `devpush.app`; self-hosted installs may set it to a wildcard
domain they control. Per-project route hosts can still be changed in project
settings.
`DEVPUSH_TRAEFIK_EMAIL` is passed to installed agents for Let's Encrypt account
registration when HTTPS routes are enabled.

Server install commands contain a time-limited enrollment token. devpush stores
only the token hash, so the Servers page can generate a fresh install command
for an existing server when you need to reconnect or reinstall the agent.

## Production control plane

The MVP production Compose file builds the TanStack Start app and embeds the
Linux agent binary used by the server installer:

```bash
cp deploy/.env.production.example deploy/.env.production
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

If your host exposes Compose as the standalone v2 binary, use `docker-compose`
with the same arguments.

Set `BETTER_AUTH_URL` to the public HTTPS URL of the control plane before adding
servers. The app container currently runs `pnpm --dir app db:push` on startup;
replace that with explicit migrations before treating this as a stable
production deployment. The production Compose file mounts `app_uploads` at
`/app/app/public/uploads` so user and team avatar uploads survive app container
recreates.

## Commands

```bash
pnpm --dir app dev
pnpm --dir app build
pnpm --dir app typecheck
pnpm --dir app lint
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
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

Use `docker-compose` instead of `docker compose` on hosts where Compose is
installed as the standalone binary.

`pnpm smoke:deploy` uses the local Postgres database to seed a disposable
user/team/server/project, register the server agent, queue a deployment, claim
it through the agent job protocol, complete it, verify persisted logs, and clean
up the seeded rows. It requires `deploy/compose.yml` Postgres to be running and
the schema to be synced with `pnpm --dir app db:push`.

`pnpm smoke:agent` runs the agent's opt-in Docker smoke tests. It creates
temporary Git repositories with Compose files, runs the real agent deployment
path against local Docker Compose, verifies the release command ran through a
mounted volume, verifies an HTTP route through managed Traefik when Docker can
publish port 80, and cleans up the Compose projects.

`pnpm validate:local` runs the local MVP gate before a remote VPS attempt:
typecheck, lint, app tests, control-plane deploy smoke, agent tests, local
smoke-mode config validation, and the real Docker/Traefik agent smoke. Set
`DEVPUSH_SKIP_DOCKER_SMOKE=1` only when Docker is unavailable.

`pnpm validate:config` checks the local MVP configuration before a real run:
auth URL, OAuth credentials, GitHub App private key, Resend OTP settings,
default app domain, and the agent binary path. Use remote mode before adding a
real VPS:

```bash
pnpm validate:config -- --env deploy/.env.production --remote
```

`pnpm validate:production` checks the production Compose config, builds the
control-plane image, and verifies that the runtime image contains the Linux
agent binary, the built server entrypoint, and `drizzle-kit`.

`pnpm validate:remote` validates the generated server installer against a real
remote host over SSH. It requires `DEVPUSH_SERVER_URL`, `DEVPUSH_REMOTE_HOST`,
and `DEVPUSH_INSTALL_COMMAND`; see
[local setup](./docs/development/local-setup.md#remote-mvp-validation). Set
`DEVPUSH_FULL_PROOF=1` with `DEVPUSH_PROJECT_URL` after a GitHub-backed deploy
to require the public route and managed Traefik checks. On failure it prints
best-effort remote diagnostics, including agent service status/logs, Docker
containers/networks, and listeners on ports 80/443.

The control-plane and deployed route URLs must use HTTPS unless
`DEVPUSH_ALLOW_INSECURE_SERVER_URL=1` is set for a local or private test
network.
Successful remote validation writes a summary to
`.tmp/remote-mvp-validation-<timestamp>.md` or `DEVPUSH_REMOTE_SUMMARY_PATH`.

`pnpm validate:remote:proof` runs the full remote proof gate: production config
validation, production image validation, and remote full proof with
`DEVPUSH_FULL_PROOF=1`. It requires `DEVPUSH_PROJECT_URL` in addition to the
remote installer environment, and verifies that the proof env file
`BETTER_AUTH_URL` matches `DEVPUSH_SERVER_URL`.

For remote server enrollment, run `pnpm agent:build:linux` and set
`DEVPUSH_AGENT_BINARY_DIR` to the generated `bin` directory.

## Docs

- [Architecture](./ARCHITECTURE.md)
- [Local setup](./docs/development/local-setup.md)
- [TODO](./TODO.md)
- [Docs index](./docs/index.md)
