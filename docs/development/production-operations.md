# Production operations

## Deploy and upgrade

Pin the image or source revision you deploy. Before every upgrade, create a
PostgreSQL backup and review the new SQL files under
`app/src/server/db/migrations`. The app runs `pnpm --dir app db:migrate` before
starting; it never runs `drizzle-kit push` in production.

Keep `BETTER_AUTH_SECRET` and `DEVPUSH_SECRET_ENCRYPTION_KEY` stable across
upgrades. Changing the encryption key makes stored application secrets
unreadable.

Existing installations created by the old `db:push` startup command have no
migration history. Upgrade them once with:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec postgres \
  pg_dump -U devpush -d devpush -Fc -f /tmp/devpush-before-migrations.dump
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml run --rm \
  -e DEVPUSH_CONFIRM_BASELINE=1 app pnpm --dir app db:baseline
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

Copy the dump off the database container before continuing. The baseline
command validates the pre-migration schema and refuses databases that already
have migration history.

Migrations are forward-only. To roll back a schema-changing release, stop the
app, restore the pre-upgrade dump into an empty database, and deploy the previous
pinned image or source revision.

## Health and maintenance

`GET /api/health` returns 200 only when the app can query PostgreSQL. The
production Compose healthcheck uses it. The scheduler calls an authenticated
maintenance endpoint hourly to expire invites and process account cleanup jobs.
`DEVPUSH_CRON_SECRET` is required by production Compose.

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

## Agent credentials

Rotate a host's credential only when it may have been exposed or as part of a
security policy:

```sh
sudo devpush-agent credential rotate
```

The command authenticates with the current credential, atomically stores its
replacement, and restarts the agent. It does not reinstall Docker or the agent.
