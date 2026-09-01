# Cloudflare deployment

The devpush control plane can run as a Cloudflare Worker. PostgreSQL remains the
system of record and the Go agent still runs on each deployment server.
Self-hosting remains supported through the production Docker Compose setup.

## Runtime mapping

| Concern                    | Cloudflare                             | Self-hosted                         |
| -------------------------- | -------------------------------------- | ----------------------------------- |
| TanStack Start app         | Workers                                | Node.js container                   |
| Database                   | External PostgreSQL through Hyperdrive | Direct PostgreSQL connection        |
| Avatars and agent binaries | R2 binding                             | Filesystem or S3-compatible storage |
| Scheduling                 | Cron Trigger                           | Authenticated maintenance endpoints |

Hyperdrive does not replace PostgreSQL. It reuses and pools connections from
Workers and avoids paying a new database connection setup cost for every isolate
or request. It is useful because direct database connections are a poor match
for an elastic serverless runtime; it adds little value to the long-lived Node.js
self-hosted process, which already owns a normal connection pool.

The Worker creates a `pg` client inside each fetch or scheduled invocation and
closes it afterward. Hyperdrive owns the reusable connection pool near the
database. The self-hosted process continues to use its module-level `pg.Pool`.

The Cron Trigger runs control-plane work only. Every minute it queues due backup
jobs when backups are enabled. At the top of each hour it removes expired team
invites and advances queued user-deletion cleanup. Agents still perform the
actual server and backup work.

## Configure Cloudflare

Run the repository setup wizard:

```bash
pnpm configure
```

Choose **Cloudflare Workers**. The wizard reads the authenticated Cloudflare
account and its `workers.dev` subdomain from Wrangler and Cloudflare, then
constructs the selected Worker's public URL or configures a custom domain. It
collects the PostgreSQL origin URL, creates or connects R2 and Hyperdrive,
disables Hyperdrive query caching, records the installation-admin email, and
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

devpush currently requires PostgreSQL; D1/SQLite is not a drop-in deployment
option. The application schema, migrations, locking, and server services use
PostgreSQL semantics. The database can be supplied by Neon, Supabase, RDS,
another managed PostgreSQL service, or a reachable self-managed server.
Supabase is not required. Setup creates Hyperdrive against the supplied
connection URL, but it does not create the PostgreSQL database itself.

Wrangler requires the PostgreSQL connection string as a command argument when
creating Hyperdrive. Run setup only on a trusted workstation: another process
running as the same local user may be able to inspect that argument while the
command is active.

The generated deployment files are intentionally ignored by Git:

- `app/wrangler.jsonc`: Worker name, public configuration, custom routing, and
  resource binding IDs.
- `app/.cloudflare-secrets.json`: secrets uploaded atomically with deployment.
- `app/.cloudflare-database.env`: the origin PostgreSQL URL used only by
  migration tooling.

The repository tracks `app/wrangler.template.jsonc`, which contains only shared
Worker defaults and no installation-specific IDs or domains. Re-run
`pnpm configure` to change the Worker, database, R2 bucket, Hyperdrive
configuration, public URL, or GitHub App. Existing resources can be selected
without recreating them.
If resource creation is interrupted, the wizard keeps
`app/wrangler.pending.jsonc`; the next run offers to resume and skips
any resource whose binding was already recorded.

Add Google and Resend values to `app/.cloudflare-secrets.json` when those
integrations are enabled. Set `DEVPUSH_BASE_URL` to the final HTTPS
control-plane origin.
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
applies reviewed SQL migrations directly to the PostgreSQL origin, builds and
publishes the Linux amd64 and arm64 agents to R2, builds the Worker with
`app/wrangler.jsonc`, and deploys it with `app/.cloudflare-secrets.json` in the
same Wrangler operation. Migrations run before the new Worker because the new
application version may depend on them; no manually repeated migration or agent
upload commands are required for the normal deployment path.

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
