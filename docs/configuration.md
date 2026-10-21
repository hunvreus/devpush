---
description: Configure installation URLs, authentication, storage and agents.
---

# Configuration

Run `pnpm configure` from the repository root. Choose local development,
Cloudflare Workers or a Docker Compose control plane. The wizard writes
configuration and can provision selected Cloudflare resources after confirmation;
it does not deploy the app.

| Target | Configuration |
| --- | --- |
| Local Node | `app/.env` |
| Production Docker Compose | `deploy/.env.production` |
| Cloudflare | `app/wrangler.jsonc` and `app/.cloudflare-secrets.json` |

These installation-specific files are ignored by Git. Start from the matching
example/template for a new installation. Reuse existing values during an upgrade.
Deployment configuration is separate from project settings managed inside devpush.

## Minimum working configuration

Before starting a public installation, configure:

| Requirement | Setting or setup |
| --- | --- |
| Stable dashboard origin | `DEVPUSH_BASE_URL`, using HTTPS. |
| Authentication and secret encryption | Independent `BETTER_AUTH_SECRET` and `DEVPUSH_SECRET_ENCRYPTION_KEY`. Preserve them across upgrades. |
| Installation administrator | `DEVPUSH_ADMIN_EMAIL`. |
| Sign-in | At least one of Resend email codes, Google credentials or GitHub App OAuth credentials. There is no development bypass. |
| GitHub deployment access | GitHub App ID, name, client ID/secret, private key and webhook secret; see Authentication below. |
| Data storage | Separate main and log databases, selected by the target's setup wizard. |
| Scheduler authentication | `DEVPUSH_CRON_SECRET` for production Compose; Worker cron does not need it. |

The wizard prepares configuration; the [installation guides](/docs/self-hosting/)
explain how to start or deploy it. Optional settings follow below.

## Installation URLs and secrets

| Setting | Purpose |
| --- | --- |
| `DEVPUSH_BASE_URL` | Control-plane origin used by agents, installers and generated links. Defaults to `http://localhost:7429` locally. |
| `BETTER_AUTH_URL` | Optional browser authentication origin; defaults to the base URL. |
| `DEVPUSH_MCP_URL` | Optional full MCP endpoint; defaults to the base URL followed by `/mcp`. |
| `BETTER_AUTH_SECRET` | Authentication and linked GitHub/Google token encryption. |
| `DEVPUSH_SECRET_ENCRYPTION_KEY` | Encrypts stored credentials and project secrets. |
| `DEVPUSH_ADMIN_EMAIL` | Installation administrator; otherwise the earliest-created user is selected. |
| `DEVPUSH_SIGN_IN_MESSAGE` | Optional public login notice, plain text up to 1,000 characters. Blank hides it. Restart/redeploy after changing; access restrictions remain in the allowlist. |
| `DEVPUSH_CRON_SECRET` | Authenticates the external scheduler; required for production Compose. Worker cron invokes services directly. |

Public origins require HTTPS. Origins must not contain a path, credentials, query
or fragment; the MCP setting must end in `/mcp`. Localhost and Lima development
origins may use HTTP. Changing the MCP endpoint requires OAuth clients to reconnect;
API-key clients need the updated URL.

Generate authentication, encryption and scheduler secrets independently, for example
with `openssl rand -base64 32`. Public installations reject weak or example secrets.
Keep the authentication and encryption keys stable across upgrades. Changing the
encryption key makes saved secrets unreadable. Changing `BETTER_AUTH_SECRET` also
makes encrypted GitHub/Google tokens unreadable; preserve both secrets in backups.

## Authentication

Configure one or more sign-in methods. GitHub repository installation permissions
are separate from a user's ability to sign in.

| Integration | Settings |
| --- | --- |
| Email codes and notifications | `EMAIL_FROM`, `RESEND_API_KEY` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub App | `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET` |

Email currently uses Resend; SMTP is not supported. Use a verified sender domain
in production. Provider acceptance confirms submission, not inbox delivery.
GitHub and Google sign-in require a verified email permitted by the installation.

Register these URLs, replacing the example origin with your installation:

| Provider field | URL |
| --- | --- |
| Google authorized JavaScript origin | `https://devpush.example.com` |
| Google authorized redirect URI | `https://devpush.example.com/api/auth/callback/google` |
| GitHub user authorization callback | `https://devpush.example.com/api/auth/callback/github` |
| GitHub post-installation setup URL | `https://devpush.example.com/api/github/install/callback` |
| GitHub webhook URL | `https://devpush.example.com/api/github/webhook` |

Use the browser authentication origin for sign-in callbacks and the publicly
reachable control-plane origin for installation callbacks and webhooks. Local
callbacks can use `http://localhost:7429`, but GitHub webhooks require an
internet-reachable endpoint. The [local guide](/docs/local-setup/) explains Lima origins.

Keep separate apps/clients for local and production. When migrating an existing
production installation, edit its existing apps rather than creating replacement
identities. Update the name, icon, site links, callbacks and webhook settings to
match the destination. Do not broaden permissions as part of a branding change.

For assisted GitHub App setup, run `pnpm setup:github-app`. Manual setup must
match the generated manifest: a private app with **Contents: read-only** and
**Metadata: read-only**, subscribed to `push` and `installation_target` events.
Enable setup after installation updates; automatic user authorization on install
is disabled. Configure the URLs above and store the generated private key and
webhook secret securely. GitHub installation and account sign-in are distinct.

## Databases

Main state and bulk logs use separate databases.

| Target | Default storage |
| --- | --- |
| Node | `DEVPUSH_DATABASE_PATH=.data/devpush.sqlite` and `DEVPUSH_LOG_DATABASE_PATH=.data/logs.sqlite`, relative to the app working directory |
| Workers | `DEVPUSH_DATABASE` and `DEVPUSH_LOG_DATABASE` D1 bindings |

Either target can use remote libSQL/Turso:

```env
DEVPUSH_DATABASE_URL=libsql://your-main-database.turso.io
DEVPUSH_DATABASE_AUTH_TOKEN=your-main-token
DEVPUSH_LOG_DATABASE_URL=libsql://your-log-database.turso.io
DEVPUSH_LOG_DATABASE_AUTH_TOKEN=your-log-token
```

Both URLs must be supplied and identify different databases. Tokens can be omitted
for a server that does not require them. URLs override local paths or D1 bindings;
changing them does not migrate data. Supported schemes are `libsql`, `https` and
`http`; do not embed credentials in URLs. Use HTTP only on a trusted local network.
Apply both migration sets with the command for your deployment target. See
[Production operations](/docs/production-operations/) before changing stores or upgrading.

## Uploads and published agent binaries

Node stores uploaded objects under `app/public/uploads` by default; production
Compose persists this in its uploads volume. Workers use the `DEVPUSH_OBJECTS`
R2 binding. Either target can use S3-compatible storage by supplying the endpoint, bucket and
credentials when no R2 binding is present. An R2 binding takes precedence. Region is optional (default
`auto`):

```env
DEVPUSH_STORAGE_ENDPOINT=https://YOUR-ACCOUNT.r2.cloudflarestorage.com
DEVPUSH_STORAGE_REGION=auto
DEVPUSH_STORAGE_BUCKET=your-bucket
DEVPUSH_STORAGE_ACCESS_KEY_ID=your-access-key
DEVPUSH_STORAGE_SECRET_ACCESS_KEY=your-secret-key
```

This installation storage is independent of team backup destinations configured
in the UI. Preserve uploaded objects as well as databases during recovery.

## Agents, monitoring and backups

| Setting | Purpose/default |
| --- | --- |
| `DEVPUSH_AGENT_BINARY_DIR` | Directory containing published Linux agent binaries and checksums; set this explicitly to the absolute `bin/` path after a local build. |
| `DEVPUSH_TRAEFIK_EMAIL` | Optional ACME contact passed to new installers. |
| `DEVPUSH_AGENT_AUTO_UPDATE` | Enable daily updater timers in newly generated installations; default `false`. |
| `DEVPUSH_RECOMMENDED_AGENT_VERSION` | Optional update recommendation; protocol capabilities determine job compatibility. |
| `DEVPUSH_MONITORING_RETENTION_DAYS` | Raw monitoring retention, default 7 days; range 2–3650. Charts show 24 hours. |
| `DEVPUSH_BACKUPS_ENABLED` | Enable application backups; default `false`. |
| `VITE_DEVPUSH_BACKUPS_ENABLED` | Matching client build flag; production Compose derives it from the server flag. Set both for local Vite development. |

The bundled agent version comes from `app/package.json`; an optional
`DEVPUSH_VERSION_FILE` supplies installation version metadata. See
[Servers](/docs/servers/), [Backups](/docs/backups/) and [Agent maintenance](/docs/agent-maintenance/)
for behavior and recovery.

## Host agent settings

The installer writes `/etc/devpush/agent.env`. Process environment values take
precedence. Change these only as a host operator; use
[maintenance drain/resume](/docs/agent-maintenance/#switch-an-empty-server) around
a restart when work may be active:

| Setting | Purpose/default |
| --- | --- |
| `DEVPUSH_STATE_DIR` | Agent credentials, outboxes and checkout state; default `/var/lib/devpush-agent`. Backup archives still use `/var/lib/devpush-agent/backups`. |
| `DEVPUSH_ROUTING_ADDRESS` | Installer-managed routing pin; use `--address IP` or `--address auto`. |
| `DEVPUSH_TRAEFIK_HTTP_PORT` / `DEVPUSH_TRAEFIK_HTTPS_PORT` | Host ingress listeners, default 80/443. Nonstandard ports also require matching external networking/URLs. |
| `DEVPUSH_TRAEFIK_EMAIL` | ACME contact for managed certificates. |
| `DEVPUSH_GIT_CLONE_BASE_URL` | Clone origin, default `https://github.com`; intended for controlled test endpoints. |
| `DOCKER_HOST` | Optional Docker daemon endpoint; otherwise Docker's default socket. Treat access as host-level privilege. |
| `DEVPUSH_RUNTIME_LOG_QUEUE_BYTES` | Captured runtime-log queue budget; default 128 MiB. |

Moving an enrolled host to another control plane requires the
[maintenance workflow](/docs/agent-maintenance/#switch-an-empty-server), not a URL edit.

## Production Compose settings

`DEVPUSH_HTTP_PORT` publishes the control plane's container port 3000 on host port
7429 by default. Point your reverse proxy at that host listener.
`COMPOSE_PROFILES=backups` enables daily local database snapshots;
`DEVPUSH_DB_BACKUP_RETENTION_DAYS` defaults to seven. Remote databases need their
provider's backup tooling instead. These are deployment settings, separate from
project application backups. See [Production operations](/docs/production-operations/).

## Reverse proxies

Node defaults to `DEVPUSH_TRUST_PROXY=false`. Behind a trusted proxy, enable it
and choose `DEVPUSH_CLIENT_IP_HEADER=x-forwarded-for` (default) or `x-real-ip`.
The proxy must overwrite that header with the verified client address. There is
no fallback to another header; for a list, the rightmost value is used.

A TLS-terminating proxy must also overwrite `X-Forwarded-Proto` and
`X-Forwarded-Host` with the external origin. Only configured app/auth/MCP origins
are trusted. Forward WebSocket upgrades for `/api/workspaces/updates`.
Workers use Cloudflare's client address automatically.
