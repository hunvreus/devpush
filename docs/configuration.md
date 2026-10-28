---
description: Configure installation URLs, authentication, storage and agents.
---

# Configuration

Run `pnpm configure` from the repository root and choose a target. The wizard writes Git-ignored configuration files. It can also create Cloudflare resources after you confirm. It does not deploy.

| Target | Configuration |
| --- | --- |
| Local Node | `app/.env` |
| Docker Compose | `deploy/.env.production` |
| Cloudflare | `app/wrangler.jsonc` and `app/.cloudflare-secrets.json` |

Reuse existing values during upgrades. A public installation needs:

- An HTTPS `DEVPUSH_BASE_URL`.
- Independent authentication and encryption secrets.
- `DEVPUSH_ADMIN_EMAIL`.
- At least one sign-in method. There is no development sign-in bypass.
- A GitHub App.
- Separate main and log databases.

## URLs and secrets

| Setting | Purpose |
| --- | --- |
| `DEVPUSH_BASE_URL` | Origin used by agents, installers and links. Local default `http://localhost:7429`. |
| `BETTER_AUTH_URL` | Optional browser authentication origin; defaults to the base URL. |
| `DEVPUSH_MCP_URL` | Optional MCP endpoint; defaults to the base URL plus `/mcp`. |
| `BETTER_AUTH_SECRET` | Authentication and linked GitHub/Google token encryption. |
| `DEVPUSH_SECRET_ENCRYPTION_KEY` | Encrypts stored credentials and project secrets. |
| `DEVPUSH_ADMIN_EMAIL` | Installation administrator. If unset, the earliest-created user. |
| `DEVPUSH_CRON_SECRET` | Only needed for optional external maintenance calls. |

Public origins require HTTPS. They must not contain a path, credentials, query or fragment. The MCP URL must end in `/mcp`. Localhost and Lima origins may use HTTP. If you change the MCP URL, OAuth clients must reconnect and API-key clients must update it.

Generate each secret independently, for example with `openssl rand -base64 32`. Public installations reject weak or example values. Include both secrets in backups. Changing the encryption key makes saved secrets unreadable. Changing `BETTER_AUTH_SECRET` makes stored GitHub/Google tokens unreadable.

## Authentication

| Integration | Settings |
| --- | --- |
| Email codes and notifications | `EMAIL_FROM`, `RESEND_API_KEY` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub App | `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET` |

Email uses Resend; SMTP is not supported. Use a verified sender domain. Resend accepting a message does not confirm inbox delivery. GitHub and Google sign-in require a verified email address that the installation permits.

Register these URLs, replacing the example origin with yours:

| Provider field | URL |
| --- | --- |
| Google authorized JavaScript origin | `https://devpush.example.com` |
| Google authorized redirect URI | `https://devpush.example.com/api/auth/callback/google` |
| GitHub user authorization callback | `https://devpush.example.com/api/auth/callback/github` |
| GitHub post-installation setup URL | `https://devpush.example.com/api/github/install/callback` |
| GitHub webhook URL | `https://devpush.example.com/api/github/webhook` |

Sign-in callbacks use the authentication origin. Installation callbacks and webhooks use the public dashboard origin. Local callbacks can use `http://localhost:7429`, but webhooks need an endpoint reachable from the internet. For Lima origins, see [Local development](/docs/local-setup/#local-deployment-vm).

For assisted setup, run `pnpm setup:github-app`. A manually created app must match the generated manifest:

- A private app.
- **Contents: read-only** and **Metadata: read-only** permissions.
- Subscribed to the `push` and `installation_target` events.
- Setup on installation updates enabled.
- Automatic user authorization on install disabled.

Keep separate apps for local and production installations. When you move an installation, edit its existing apps instead of creating new ones. Don't broaden their permissions.

## Databases

Node defaults to `DEVPUSH_DATABASE_PATH=.data/devpush.sqlite` and `DEVPUSH_LOG_DATABASE_PATH=.data/logs.sqlite`, relative to the app directory. Workers use the `DEVPUSH_DATABASE` and `DEVPUSH_LOG_DATABASE` D1 bindings. Either target can use remote libSQL/Turso:

```env
DEVPUSH_DATABASE_URL=libsql://your-main-database.turso.io
DEVPUSH_DATABASE_AUTH_TOKEN=your-main-token
DEVPUSH_LOG_DATABASE_URL=libsql://your-log-database.turso.io
DEVPUSH_LOG_DATABASE_AUTH_TOKEN=your-log-token
```

Supply both URLs, pointing to different databases. Tokens are optional only when the database does not require authentication. Supported schemes are `libsql`, `https` and `http`; use `http` only on trusted networks. Don't embed credentials in the URLs. The URLs override local paths and D1 bindings but do not migrate data. Read [Production operations](/docs/production-operations/) before changing stores.

## Image uploads

Node stores uploads under `public/uploads` in its working directory; Compose persists them in a volume. Workers use the optional `DEVPUSH_OBJECTS` R2 binding. Either target can use S3-compatible storage instead. An R2 binding takes precedence, and the region defaults to `auto`:

```env
DEVPUSH_STORAGE_ENDPOINT=https://YOUR-ACCOUNT.r2.cloudflarestorage.com
DEVPUSH_STORAGE_REGION=auto
DEVPUSH_STORAGE_BUCKET=your-bucket
DEVPUSH_STORAGE_ACCESS_KEY_ID=your-access-key
DEVPUSH_STORAGE_SECRET_ACCESS_KEY=your-secret-key
```

On Workers without R2 or S3, upload controls are hidden; provider avatars and generated fallbacks still work. Node retains local uploads without remote storage. This storage is separate from team backup destinations, and agent downloads don't use it.

## Agents and backups

| Setting | Purpose/default |
| --- | --- |
| `DEVPUSH_AGENT_BINARY_DIR` | Absolute path to trusted Linux binaries. Overrides [release downloads](/docs/agent-releases/) on Node. Docker sets it; don't set it on Workers. |
| `DEVPUSH_TRAEFIK_EMAIL` | Optional ACME contact for new installers. |
| `DEVPUSH_AGENT_AUTO_UPDATE` | Daily updater timer for new installations; default `false`. |
| `DEVPUSH_RECOMMENDED_AGENT_VERSION` | Optional update recommendation. Protocol capabilities decide job compatibility. |
| `DEVPUSH_DEPLOYMENT_QUEUE_TTL_HOURS` | Maximum time a deployment can wait for an agent; default 24 hours, range 1–720. |
| `DEVPUSH_DEPLOYMENT_LOG_MAX_LINES` | Lines retained per deployment; default 5000, range 1–100000. |
| `DEVPUSH_DEPLOYMENT_LOG_LINE_BYTES` | Bytes retained per line; default 2048, range 64–65536. |
| `DEVPUSH_MONITORING_RETENTION_DAYS` | Raw monitoring retention in days; default 7, range 2–3650. |
| `DEVPUSH_BACKUPS_ENABLED` | Enables application [backups](/docs/backups/); default `false`. |
| `VITE_DEVPUSH_BACKUPS_ENABLED` | Matching build flag. Compose derives it; set it yourself for local Vite and Workers builds. |

`DEVPUSH_VERSION_FILE` optionally supplies installation version metadata.

## Host agent settings

The installer writes `/etc/devpush/agent.env`. Process environment values take precedence. If work may be active, drain the agent before you restart it; see [Updates and draining](/docs/agent-maintenance/#updates-and-draining).

| Setting | Purpose/default |
| --- | --- |
| `DEVPUSH_STATE_DIR` | Credentials, outboxes and checkouts; default `/var/lib/devpush-agent`. Backup archives stay in `/var/lib/devpush-agent/backups`. |
| `DEVPUSH_ROUTING_ADDRESS` | Routing pin, set by `--address IP` or `--address auto`. |
| `DEVPUSH_TRAEFIK_HTTP_PORT` / `DEVPUSH_TRAEFIK_HTTPS_PORT` | Ingress ports; default 80/443. Other ports need matching networking and URLs. |
| `DEVPUSH_TRAEFIK_EMAIL` | ACME contact for managed certificates. |
| `DEVPUSH_GIT_CLONE_BASE_URL` | Clone origin; default `https://github.com`. Testing-only; keep the default for normal installations. |
| `DOCKER_HOST` | Optional Docker endpoint. Access to it is host-level privilege. |
| `DEVPUSH_DISABLE_INACTIVE_REDIRECTS` | Set `true` to keep inactive deployment URLs at a local 404 instead of redirecting to the dashboard. Default `false`; restart the agent after changing it. |
| `DEVPUSH_RUNTIME_LOG_QUEUE_BYTES` | Runtime-log queue budget; default 128 MiB. |

To move a host to another installation, [switch an empty server](/docs/agent-maintenance/#switch-an-empty-server). Editing the URL is not enough.

## Reverse proxies

Node defaults to `DEVPUSH_TRUST_PROXY=false`. Behind a trusted proxy, enable it and set `DEVPUSH_CLIENT_IP_HEADER`. Use `x-forwarded-for` (the default; the rightmost value is used) or `x-real-ip`. The proxy must:

- Overwrite the client IP header, `X-Forwarded-Proto` and `X-Forwarded-Host`.
- Forward WebSocket upgrades for `/api/workspaces/updates`.

Only the configured app, auth and MCP origins are trusted. Workers use Cloudflare's client address.

External schedulers can call `POST /api/cron/maintenance` hourly and `POST /api/cron/backups` each minute when backups are enabled, using `Authorization: Bearer YOUR_CRON_SECRET`. Built-in scheduling needs neither HTTP calls nor this secret.

## Runtime log budgets

Runtime logs are kept for 24 hours, with at most 10,000 rows per runtime. No additional team-wide budget applies by default.

An installation may enforce extra limits. When a batch exceeds them, it is dropped and a visible notice appears at most once per UTC day. Collection resumes when the limit window resets; dropped logs cannot be recovered. Deployment logs have separate limits.
