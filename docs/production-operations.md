---
description: Run, upgrade and recover a Docker Compose control plane.
---

# Install with Docker Compose

The Docker Compose deployment runs the Node app, a one-shot migrator and an
external scheduler. Applications run on separate agent-managed servers.

## Install

Use a checkout of the devpush repository. On the machine used for setup, install
Node.js 22+ and pnpm 10.17+. The deployment host needs Docker with Compose.
The image build compiles the app and agent; a host Go installation is not needed
for this Docker build.

```sh
git clone https://github.com/hunvreus/devpush.git
cd devpush
pnpm install --frozen-lockfile
pnpm configure
```

Choose **Docker Compose (self-hosted)**. Review the generated
`deploy/.env.production`, configure at least one sign-in provider and set
`DEVPUSH_ADMIN_EMAIL`. See [Authentication](/docs/configuration/#authentication)
for callback URLs and GitHub App permissions.

Point a stable HTTPS origin at the app's host listener (port 7429 by default).
Configure the [reverse proxy](/docs/configuration/#reverse-proxies) and firewall
before exposing the app. The supplied Compose file does not provide the dashboard's
TLS reverse proxy. Application HTTPS on deployment servers is handled separately.
The published app listener binds all host interfaces by default: restrict direct
access so requests pass through the trusted proxy. Avoid enrolling this same host
as an application server if its existing reverse proxy occupies ports 80/443.

Start the installation:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
curl --fail http://localhost:7429/api/health
```

If you changed `DEVPUSH_HTTP_PORT`, use that port in the health request.
Expect a successful health response, then sign in at the configured public URL.
Check the app, migration and scheduler logs if startup fails:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs --tail=100 app migrate scheduler
```

Restrict access in [Admin](/docs/administration/), arrange installation backups,
then [connect a server and deploy an app](/docs/getting-started/).

## Deploy and upgrade

Main and log databases start at their respective `0000_initial` release baselines
and upgrade forward from there. Databases from the older chain predating
`0000_initial` need backup/export and fresh stores; the post-baseline migrations
listed below are supported upgrades.

If upgrading from the Admin-editable sign-in message, copy its text to
`DEVPUSH_SIGN_IN_MESSAGE` before applying `0002_remove_installation_settings`.
That migration removes the old message table. Pass the variable into the app's
environment; see [Sign-in message](/docs/administration/#sign-in-message).

Pin the image or source revision you deploy. Before every upgrade, create a
backup of both SQLite stores and review the new SQL files under
`app/src/server/db/migrations-sqlite` and `migrations-logs`. A one-shot `migrate` Compose service runs
the bundled migration runner and publishes agent binaries to configured object
storage before the app starts. The app process never mutates the schema and
production never runs `drizzle-kit push`. Both maintenance runners are bundled
during the image build, so the runtime does not contain the development
dependency tree or require `tsx`.

Keep `BETTER_AUTH_SECRET` and `DEVPUSH_SECRET_ENCRYPTION_KEY` stable across
upgrades. Changing the encryption key makes stored application secrets
unreadable.

Set `DEVPUSH_ADMIN_EMAIL` explicitly in production. Leaving it unset delegates
installation administration to the earliest-created user, which is intended as
a bootstrap fallback rather than an operational role-management mechanism.

Migrations are forward-only. To roll back a schema-changing release, stop the
app, restore the pre-upgrade snapshots into empty database files, and deploy the previous
pinned image or source revision.

For a source-built upgrade, back up the databases and uploads first, check out
the reviewed release revision, then run:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
curl --fail http://localhost:7429/api/health
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs --tail=100 app migrate scheduler
```

Use the configured `DEVPUSH_HTTP_PORT` if changed. For prebuilt images, set
`DEVPUSH_PRODUCTION_IMAGE` in `deploy/.env.production` to the reviewed image tag
or digest; all services use that image. Pull it before `up -d --no-build`.
Check the migration service
and app health before opening traffic. Never replace encryption keys on upgrade.

### Release database baseline

The main database starts with `0000_initial.sql`, containing the application/OAuth
schema, indexes, backup-storage safeguards, settings-version triggers and credential
revocation triggers. Supported later migrations apply in order:
`0001_installation_settings` added the old message table, and
`0002_remove_installation_settings` removes it in favor of environment configuration. The logs database has its
own `0000_initial.sql` baseline for deployment/runtime/operation logs and cleanup
positions. Drizzle snapshots/journals match these baselines; subsequent schema
changes must add migrations without rewriting applied files.

The earlier chain predating `0000_initial` is retired. This is different from the
supported `0001`/`0002` migrations following that baseline. Do not apply this baseline
to a database created by that chain. Stop the app and scheduler, back up/export
both stores, and prepare fresh databases before switching to this release.
SQLite/libSQL runners reject an unknown or missing migration history on a
populated database before applying SQL. For D1, use fresh main/log databases and
update their bindings. There is no automatic pre-release data conversion.

Backup runs and queued jobs store location metadata and a storage connection ID;
current credentials are loaded only when the agent claims work. The baseline
does not convert databases from the retired chain. Use the
agent built with this release; flattening the schema itself changes no agent
protocol.

## Health and maintenance

`GET /api/health` returns 200 only when the app can query the main database. The
production Compose healthcheck uses it. The scheduler calls an authenticated
maintenance endpoint hourly to expire invites, process account cleanup, and prune monitoring, logs and API/OAuth history in bounded batches. Monitoring retention defaults to seven days and is configurable with `DEVPUSH_MONITORING_RETENTION_DAYS`.

The Compose scheduler calls maintenance on its first minute tick and once per UTC
hour after success. Failed calls log an error and retry on the next minute tick;
backup scheduling failures do not prevent maintenance. Each request has a
five-second connection timeout and a 45-second overall timeout.
`DEVPUSH_CRON_SECRET` is required by production Compose.

API replay records become eligible for pruning after 24 hours and accepted
operation audit records after 30 days. Expired OAuth access/refresh tokens are
also pruned. Each maintenance invocation removes at most 500 eligible rows from
each of those tables, so a backlog can remain across invocations. Revoked or
rotated refresh tokens are retained until expiry for token-family replay
detection. This maintenance does not remove API-key or connected-app history;
membership/account deletion can remove their associated records.

Maintenance also collects eligible soft-deleted accounts, projects, servers and
teams after 30 days, with up to 100 of each resource per invocation. Associated
settings and credentials are removed through database cascades. It preserves
surviving team/project settings, audit history under its separate retention, and
resources with unresolved jobs, retained runtimes or recorded backup artifacts.
Hostname reservations are released after confirmed container removal, without
waiting for the metadata retention window. Intentionally retained runtimes keep
their reservations. External archives are not silently deleted or forgotten. Failed or abandoned
cleanup needs operator resolution before collection can finish.

### Custom scheduler

The supplied Compose companion calls these endpoints automatically. If replacing
it, send `Authorization: Bearer YOUR_CRON_SECRET` to:

| Endpoint | Cadence |
| --- | --- |
| `POST /api/cron/maintenance` | Hourly, including when application backups are disabled. |
| `POST /api/cron/backups` | Every minute when application backups are enabled. |

Workers use their Cron Trigger instead of an external caller. Do not disable
maintenance just because no backup policy is configured.

### Resolve blocked deletions

When cleanup cannot finish, use the [deletion recovery guide](/docs/deletion-recovery/)
to inspect the blocker, retry safe work or record verified manual removal.
Do not bypass cleanup by deleting database rows.

### Existing provider tokens

New linked GitHub/Google tokens are encrypted with `BETTER_AUTH_SECRET`.
If an existing database contains plaintext tokens from an older build, maintenance
rewrites up to 100 records per invocation; `providerTokens.checked` and
`providerTokens.encrypted` report progress. Fresh installations do not need this
conversion. Preserve the authentication secret and do not roll back to a binary
that expects plaintext tokens.

See [Reverse proxies](/docs/configuration/#reverse-proxies) for trusted origin and client-IP headers.

## Remote libSQL storage

Both Node and Workers support remote libSQL/Turso. Configure both database URLs
and tokens using `pnpm configure` or the environment variables in
[Configuration](/docs/configuration/#databases). Compose passes them to the
app and migrator; remote URLs override local file paths. Workers read these
settings from their environment bindings; the Cloudflare setup wizard writes
them to the deployment secrets file and omits D1 resources. Keep main and log stores
separate. Changing these settings selects new storage without moving old data.
The `backups` Compose profile deliberately fails for remote URLs to avoid
silently backing up unused local files. Configure provider backups/export for
both remote databases instead.

## Control-plane backups

The `control_plane_data` volume holds `devpush.sqlite` and `logs.sqlite`. Keep
configured database paths under `/app/storage` so they remain on this volume. Run
one app instance against this volume on a local filesystem; do not share SQLite
files over a network filesystem or mount them on independent hosts.

Set `COMPOSE_PROFILES=backups` to enable daily online SQLite backups of both
stores. Snapshots remain in `control_plane_backups` for
`DEVPUSH_DB_BACKUP_RETENTION_DAYS` days (default seven). The backup API includes
committed WAL data; copying only a live `.sqlite` file is unsafe. Each snapshot
is consistent independently, but the pair is not an atomic cross-store snapshot.
For a coordinated snapshot, stop the app and scheduler before backing up.
Copy backups off-host and test restoration.

This profile backs up databases only. The separate `app_uploads` volume contains
local avatars and published agent binaries; database snapshots do not contain
those files. Preserve that volume and installation configuration/secrets with
your host backup tooling. For a coordinated recovery point, stop the app and
scheduler while snapshotting both database stores and uploads. If object storage
is configured, use its backup/versioning tooling instead. Restore uploads before
reopening the app so database object references remain valid.

To restore, stop the app, scheduler, and backup service; replace both database
files in `control_plane_data` with the selected snapshots, remove obsolete WAL
and SHM files while all connections are closed, then start the pinned image.
Do not restore over an open SQLite connection. D1 installations use D1 recovery and
export tooling separately for each database; these Docker backups cover native
SQLite only.

## Host maintenance

See [Agent maintenance](/docs/agent-maintenance/) for safe upgrades, credential rotation,
switching an empty host and recovery of interrupted maintenance.
