# Cloudflare deployment

The control plane runs on Workers with separate main and log databases, using
D1 or remote libSQL/Turso. Go agents still run on deployment servers. Node uses
local SQLite files or remote libSQL with the same atomic mutation contracts.

| Concern | Cloudflare | Self-hosted |
| --- | --- | --- |
| App | Workers | Node.js container |
| Main state | `DEVPUSH_DATABASE` D1 binding or libSQL URL | SQLite file or libSQL URL |
| Bulk logs | `DEVPUSH_LOG_DATABASE` D1 binding or libSQL URL | Separate SQLite file or libSQL URL |
| Objects | R2 | Filesystem or S3-compatible storage |
| Maintenance | Cron Trigger | Authenticated maintenance endpoints |

D1 mutations use atomic statements and batches, not callback transactions or
connection pools. Every minute the scheduler queues due backups when enabled.
Hourly maintenance expires invites, advances account cleanup, and prunes
monitoring and log history in bounded batches. Monitoring retention defaults
to seven days (`DEVPUSH_MONITORING_RETENTION_DAYS`); runtime logs retain 24 hours.
Agents perform the actual deployments and backups outside database transactions.

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

`DEVPUSH_BASE_URL` is embedded in generated server installers, so configure the
final custom origin before enrolling servers. If the origin changes later,
re-run `pnpm configure` to update the generated Worker variables and repoint
each existing agent by changing `DEVPUSH_BASE_URL` in
`/etc/devpush/agent.env` and restarting `devpush-agent`.

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
the desired revision, run `pnpm install --frozen-lockfile`, and rerun
`pnpm deploy:cloudflare`. A first-class GitHub Actions deployment workflow is
still pending because installation-specific Wrangler bindings, application
secrets and Cloudflare credentials must be
provisioned securely in CI rather than committed to the repository.

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
Object migration. Existing deployment configurations must include the binding and
migration from `app/wrangler.template.jsonc` before deployment. Without the
binding, the UI uses HTTP polling. No additional secret is needed. Enterprise
proxies that reject WebSocket upgrades also fall back to HTTP polling.
