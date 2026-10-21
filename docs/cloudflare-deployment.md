---
description: Deploy and operate the control plane on Cloudflare Workers.
---

# Install on Cloudflare

This installs the dashboard on Cloudflare Workers. Your application containers
still run on Linux servers connected through the agent.

## Before you start

- A Cloudflare account with Workers and R2 available; D1 is the default database option.
- Node.js 22+, pnpm 10.17+ and Go 1.27+ to build the app and Linux agent binaries.
- A devpush source checkout and Wrangler signed in to the intended account.
- A stable public origin and sign-in providers. A custom domain's zone must be
  active in that same Cloudflare account.

From the checkout, install dependencies and sign in:

```sh
pnpm install --frozen-lockfile
pnpm --dir app exec wrangler login
```

Setup can create D1/R2 resources after confirmation. Review the account carefully:
these commands operate on your Cloudflare resources and can incur provider charges.
For Docker installation instead, see [Install with Docker Compose](/docs/production-operations/).

## Configure Cloudflare

Run the repository setup wizard:

```bash
pnpm configure
```

Choose **Cloudflare Workers**. The wizard reads the authenticated Cloudflare
account and its `workers.dev` subdomain from Wrangler and Cloudflare, then
constructs the selected Worker's public URL or configures a custom domain. It
offers D1 or remote libSQL for storage. It creates or connects R2 and, when D1
is selected, two distinct D1 databases. It records the installation-admin email and
optionally creates the GitHub App. Before any
Cloudflare resources are created, it displays a confirmation prompt. It does
not deploy the Worker.

The Worker name defaults to `devpush` and is editable in the wizard. A
`workers.dev` URL has the deterministic form
`https://<worker>.<account-subdomain>.workers.dev`; setup discovers the account
subdomain automatically and records the URL before deployment because
authentication origins, GitHub callback and webhook URLs, and generated agent
installers need the final control-plane origin. If a custom domain is selected,
setup adds it as a Worker Custom Domain. The zone must already be active in the
same Cloudflare account and must not have a conflicting CNAME. Re-run
`pnpm configure` before changing the public origin so dependent configuration
can be updated together.

These files select a real deployment target; they are not part of local Node/Lima
development. Generate them for the intended installation with `pnpm configure`.
The repository does not assume a staging Worker or reuse a previous test target.
Before a production migration, verify the Worker, account, resource IDs, public
origin and existing GitHub App instead of deploying an old generated configuration.

The generated deployment files are intentionally ignored by Git:

- `app/wrangler.jsonc`: Worker name, public configuration, custom routing, and
  resource binding IDs.
- `app/.cloudflare-secrets.json`: secrets uploaded atomically with deployment.

The repository tracks `app/wrangler.template.jsonc`, which contains only shared
Worker defaults, distinct local-only D1 placeholder IDs, and no installation-specific domains. Production validation rejects the placeholder IDs. Re-run
`pnpm configure` to change the Worker, databases, R2 bucket, public URL, or GitHub App. Existing resources can be selected
without recreating them.
If resource creation is interrupted, the wizard keeps
`app/wrangler.pending.jsonc`; the next run offers to resume and skips
any resource whose binding was already recorded.

The setup wizard can configure Resend email sign-in and writes `EMAIL_FROM`
and `RESEND_API_KEY` to `app/.cloudflare-secrets.json`. Without both values,
email sign-in and email invitations are disabled. Add Google credentials to
that file manually when Google sign-in is enabled. Set `DEVPUSH_BASE_URL` to
the final HTTPS control-plane origin.
Set `DEVPUSH_ADMIN_EMAIL` explicitly for production; leaving it blank makes the
earliest-created user the installation administrator. Keep
`DEVPUSH_SECRET_ENCRYPTION_KEY` stable across deployments because it protects
stored application secrets.
`BETTER_AUTH_URL` is optional and defaults to `DEVPUSH_BASE_URL`; set it only
when authentication must use a different origin. Set
`DEVPUSH_BACKUPS_ENABLED=true` as a Worker secret and export
`VITE_DEVPUSH_BACKUPS_ENABLED=true` while building if project backups should be
visible. The Worker Cron Trigger calls maintenance services directly, so it does
not require `DEVPUSH_CRON_SECRET`. That secret is still required by the
self-hosted production Compose deployment, where it protects the HTTP
maintenance endpoints.

`DEVPUSH_MCP_URL` is an optional public Worker variable naming the full canonical
assistant endpoint. It defaults to `DEVPUSH_BASE_URL` plus `/mcp`. To expose MCP
through a different HTTPS origin, add the variable to `vars` in the generated
`app/wrangler.jsonc`:

```json
"DEVPUSH_MCP_URL": "https://mcp.example.com/mcp"
```

That origin must serve both `/mcp` and
`/.well-known/oauth-protected-resource/mcp` from the same control plane.
`BETTER_AUTH_URL` remains the authorization issuer. Changing the MCP resource
URL requires OAuth clients to reconnect; agent URLs and API keys are unchanged.
Public MCP origins require the same strong auth and encryption secrets as the
public control plane.

`DEVPUSH_BASE_URL` is embedded in generated server installers, so configure the
final custom origin before enrolling servers. Two later changes need different handling:

- **Same installation, new origin:** preserve its databases, encryption keys and
  enrolled identities. Update Worker origins and provider callbacks, then update
  `DEVPUSH_BASE_URL` in each existing agent's `/etc/devpush/agent.env` and restart
  the agent. Keep the old endpoint available during the transition and verify
  reconnection and pending work before removing it.
- **Different installation:** editing a URL does not transfer ownership or data.
  The [maintenance switch](/docs/agent-maintenance/#switch-an-empty-server) supports
  empty servers only; active-server ownership migration is not supported.

## Validate and deploy

After setup, validate the generated Worker build without changing production:

```bash
pnpm validate:cloudflare
```

Deploy with one command:

```bash
pnpm deploy:cloudflare
```

The deployment command first validates the generated configuration. It then
applies reviewed SQL migrations to the selected main and log databases (D1 or libSQL), builds and
publishes the Linux amd64 and arm64 agents to R2, builds the Worker with
`app/wrangler.jsonc`, and deploys it with `app/.cloudflare-secrets.json` in the
same Wrangler operation. Migrations run before the new Worker because the new
application version may depend on them; no manually repeated migration or agent
upload commands are required for the normal deployment path.

This command performs one deployment; setup does not connect the devpush source
repository to an automatic deployment pipeline. For later manual updates, pull
the desired revision, back up/export both databases, review new migrations, run
`pnpm install --frozen-lockfile`, and rerun `pnpm deploy:cloudflare`.
When backups are enabled, export `VITE_DEVPUSH_BACKUPS_ENABLED=true` for **every**
deployment build, as well as keeping the server backup flag enabled. Keep installation-specific bindings and deployment
credentials in the deployment environment rather than committing them.

The Worker reads agent binaries through its `DEVPUSH_OBJECTS` binding. The
self-hosted app continues to use filesystem storage by default or the
`DEVPUSH_STORAGE_*` S3-compatible variables when remote object storage is
desired.

After deployment, update any separately configured Google OAuth callbacks to
the selected HTTPS origin, then exercise login,
server enrollment, avatar upload, agent download, and a real deployment.

Use Wrangler deployment history and rollback for Worker rollback. Database
migrations remain forward operational changes and need their own reviewed
rollback plan.

## Remote libSQL / Turso

Choose **Turso / remote libSQL** in the wizard and supply two existing database
URLs and their optional tokens. Setup writes `DEVPUSH_DATABASE_URL`,
`DEVPUSH_LOG_DATABASE_URL`, `DEVPUSH_DATABASE_AUTH_TOKEN`, and
`DEVPUSH_LOG_DATABASE_AUTH_TOKEN` to `app/.cloudflare-secrets.json`, and omits
D1 bindings. It does not create databases at the remote provider.

Both URLs select libSQL at runtime, even if D1 bindings are also present.
Without URLs, Workers require both D1 bindings. Incomplete remote settings fail
validation instead of falling back. No extra database-driver setting is needed.

`pnpm --dir app db:migrate:cloudflare` reads the same Wrangler variables and
secrets as deployment and applies both libSQL migration sets. `--local` is
rejected in remote mode, so a local migration command cannot modify a hosted
database. Changing storage settings does not transfer existing data. Configure
provider backups for both remote databases.

For isolated configurations, `DEVPUSH_WRANGLER_CONFIG` and
`DEVPUSH_CLOUDFLARE_SECRETS_FILE` override the paths used by preflight and
migration commands. Deployment and dry-run commands also honor the secrets-file
override; its default is `app/.cloudflare-secrets.json`.

## Local D1 migrations

With a generated Wrangler configuration, apply migrations to local D1 only:

```bash
pnpm --dir app db:migrate:cloudflare --local
```

The command applies the main and log migration directories separately. The
normal deployment command uses remote D1; `--persist-to` is available only with
`--local`. Keep both bindings pointed at different databases.

## Workspace notifications

The Worker exports `WorkspaceUpdates`. Generated Wrangler configuration binds
`DEVPUSH_WORKSPACE_UPDATES` and applies the `workspace-updates-v1` SQLite Durable
Object migration. The binding enables live notifications; without it, the UI uses HTTP polling.
For an existing configuration, rerun setup and review the generated binding and
migration before deployment rather than assuming the binding is present. No additional secret is needed. Enterprise
proxies that reject WebSocket upgrades also fall back to HTTP polling.

## Object storage and installation metadata

The Worker has no local-upload fallback. Configure the `DEVPUSH_OBJECTS` R2
binding or the documented S3-compatible storage credentials before using object
storage. Without either, writes fail explicitly. Installation information comes
from `CF_VERSION_METADATA`; a missing binding returns no current installation
metadata rather than attempting to read the Node installation’s version file.
