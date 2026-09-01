# Production operations

## Deploy and upgrade

devpush 1.0 starts from one clean migration baseline. Pre-1.0 development
databases are intentionally unsupported and must not be upgraded in place;
install 1.0 against an empty database.

Pin the image or source revision you deploy. Before every upgrade, create a
PostgreSQL backup and review the new SQL files under
`app/src/server/db/migrations`. A one-shot `migrate` Compose service runs
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
app, restore the pre-upgrade dump into an empty database, and deploy the previous
pinned image or source revision.

## Health and maintenance

`GET /api/health` returns 200 only when the app can query PostgreSQL. The
production Compose healthcheck uses it. The scheduler calls an authenticated
maintenance endpoint hourly to expire invites and process account cleanup jobs.
`DEVPUSH_CRON_SECRET` is required by production Compose.

The scheduler is deliberately an external HTTP caller rather than in-process
application state. VPS deployments use the Compose companion. Cloudflare
deployments use the configured Cron Trigger to invoke the same maintenance
services directly inside the Worker.

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

The installer records its phase output and suppressed package-manager details
in a root-readable timestamped log under `/var/log/devpush-agent/`.
`/var/log/devpush-agent/latest.log` points to the latest installation run. The
running agent writes to the systemd journal; inspect it with
`sudo journalctl -u devpush-agent -f`.

The control plane embeds its configured `DEVPUSH_BASE_URL` into new install
scripts. Changing the public control-plane origin requires updating
`DEVPUSH_BASE_URL` and restarting or redeploying the control plane before
generating new commands. Existing agents retain their old URL in
`/etc/devpush/agent.env`; update that file and restart `devpush-agent` when an
origin moves.

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
