---
description: Install, upgrade and back up the Node dashboard.
---

# Install with Docker Compose

The supplied stack runs the Node app, its built-in scheduler and a one-shot migrator. It bundles Linux agents. The Docker host needs Docker Compose, plus Node.js 22.12+ and pnpm 10.17+ for source setup.

## Install

Run from a [source checkout](/docs/self-hosting/) on the Docker host; keep its `deploy/.env.production` there too:

```sh
pnpm install --frozen-lockfile
pnpm configure
```

Choose **Docker Compose (self-hosted)**. Review `deploy/.env.production`, set `DEVPUSH_ADMIN_EMAIL` and configure [sign-in](/docs/configuration/#authentication).

Provide an HTTPS [reverse proxy](/docs/configuration/#reverse-proxies) pointing to host port 7429 (`DEVPUSH_HTTP_PORT`). Compose does not provide dashboard TLS. Compose publishes the listener on all interfaces; firewall direct access. If the proxy runs on this host, bind the app’s Compose `ports` entry to `127.0.0.1:7429:3000` instead. Do not enroll this host as an app server if its existing proxy occupies ports 80/443.

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
curl --fail http://localhost:7429/api/health
```

Use the configured port if different. Diagnose startup with:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs --tail=100 app migrate
```

Sign in, configure the [allowlist](/docs/accounts-and-teams/#installation-administration), arrange backups and [connect a server](/docs/getting-started/).

## Upgrade

Back up both databases and uploads, review migrations, check out the new release tag and rerun the start command. Keep `BETTER_AUTH_SECRET` and `DEVPUSH_SECRET_ENCRYPTION_KEY` unchanged.

All services run as UID/GID 1000. Existing volumes/bind mounts must grant that user access; do not make them world-writable. Run one app instance with SQLite on a local filesystem, never a network share.

The migrator applies the shipped main/log migration histories before startup. Never edit applied migrations or run schema push in production. Retired pre-release histories require a fresh installation; updating code does not reset data.

For a prebuilt image, set `DEVPUSH_PRODUCTION_IMAGE` to its reviewed tag/digest, run Compose `pull`, then `up -d --no-build` using the same file/env flags. To roll back a schema-changing release, stop the app, restore pre-upgrade databases and use the previous image tag/digest.

## Backups and recovery

`control_plane_data` holds both SQLite stores under `/app/storage`. Set `COMPOSE_PROFILES=backups` for daily online snapshots, retained seven days by default (`DEVPUSH_DB_BACKUP_RETENTION_DAYS`). Snapshots live in `/backups`, mounted from `control_plane_backups`. Copy them off-host and test restoration.

Never copy only a live `.sqlite` file: committed data may be in WAL files. Online snapshots are consistent individually; stop the app for a coordinated snapshot of both stores and uploads. Back up `app_uploads`, configuration and secrets separately.

To restore, first stop all database writers:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml stop app db-backup
```

Replace both database files, remove stale WAL/SHM files while all connections are closed, restore uploads and start the image matching those backups.

Remote libSQL uses provider backups; the local backup profile refuses remote configurations. Changing storage settings does not transfer data.

## Background work

Production Node runs a minute-based scheduler inside the app. Workers uses native cron; both call the same functions. Notification retries and enabled backup schedules run each minute; maintenance runs hourly, with failed runs retried.

Email delivery logs identify notifications without message content. Retries stop after ten attempts or 24 hours from the first attempt; there is no delivery-management screen.

`/api/health` checks the main database only. Inspect [agent diagnostics](/docs/agent-maintenance/) and real app routes separately. Use [deletion recovery](/docs/deletion-recovery/) for blocked cleanup; never delete rows to bypass it.

## Uninstall

Back up the databases, uploads and secrets first. Stop and remove the dashboard containers using the same configuration:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml down
```

This preserves named volumes. Only remove those volumes after verifying the backups and deciding to discard the installation’s data. Application containers on agent servers keep running; [remove agents](/docs/agent-maintenance/#remove-an-agent) separately when needed.
