# Production operations

## Deploy and upgrade

devpush 1.0 starts from one clean migration baseline. Pre-1.0 development
databases are intentionally unsupported and must not be upgraded in place;
install 1.0 against an empty database.

Pin the image or source revision you deploy. Before every upgrade, create a
PostgreSQL backup and review the new SQL files under
`app/src/server/db/migrations`. A one-shot `migrate` Compose service runs
`pnpm --dir app db:migrate` and publishes agent binaries to configured object
storage before the app starts. The app process never mutates the schema and
production never runs `drizzle-kit push`.

Keep `BETTER_AUTH_SECRET` and `DEVPUSH_SECRET_ENCRYPTION_KEY` stable across
upgrades. Changing the encryption key makes stored application secrets
unreadable.

Migrations are forward-only. To roll back a schema-changing release, stop the
app, restore the pre-upgrade dump into an empty database, and deploy the previous
pinned image or source revision.

## Health and maintenance

`GET /api/health` returns 200 only when the app can query PostgreSQL. The
production Compose healthcheck uses it. The scheduler calls an authenticated
maintenance endpoint hourly to expire invites and process account cleanup jobs.
`DEVPUSH_CRON_SECRET` is required by production Compose.

The scheduler is deliberately an external HTTP caller rather than in-process
application state. VPS deployments use the Compose companion. A future Workers
deployment can call the same endpoints from Cron Triggers without changing job
behavior.

## Control-plane backups

Set `COMPOSE_PROFILES=backups` to enable daily custom-format PostgreSQL dumps.
They are retained in the `control_plane_backups` volume for
`DEVPUSH_DB_BACKUP_RETENTION_DAYS` days. A volume on the same host is not
disaster recovery: copy dumps off-host and test restoration.

Restore into an empty database with:

```sh
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" devpush-YYYYMMDDTHHMMSSZ.dump
```

## Agent upgrades

Every installation creates a root-owned updater. Run it manually with:

```sh
sudo /usr/local/lib/devpush/update-agent
```

It downloads the platform binary and published SHA-256 checksum, skips an
identical binary, installs a changed binary, and restarts the agent. Set
`DEVPUSH_AGENT_AUTO_UPDATE=true` on the control plane before generating install
commands to enable a daily systemd timer for newly installed agents. Existing
hosts can opt in or out directly:

```sh
sudo systemctl enable --now devpush-agent-update.timer
sudo systemctl disable --now devpush-agent-update.timer
```

The main agent remains unprivileged; only the updater service runs as root.

The version in `app/package.json` identifies the bundled agent release shown as the
latest available version. `DEVPUSH_RECOMMENDED_AGENT_VERSION` is optional and
marks older agents as recommended updates without blocking communication.
Protocol versions and advertised capabilities—not these release strings—control
which jobs an agent can safely claim.

## Agent credentials

Rotate a host's credential only when it may have been exposed or as part of a
security policy:

```sh
sudo devpush-agent credential rotate
```

The command authenticates with the current credential, atomically stores its
replacement, and restarts the agent. It does not reinstall Docker or the agent.
