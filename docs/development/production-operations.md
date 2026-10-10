# Production operations

## Deploy and upgrade

devpush 1.0 starts from one clean migration baseline. Pre-1.0 development
databases are intentionally unsupported and must not be upgraded in place;
install 1.0 against an empty database.

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

## Health and maintenance

`GET /api/health` returns 200 only when the app can query the main database. The
production Compose healthcheck uses it. The scheduler calls an authenticated
maintenance endpoint hourly to expire invites, process account cleanup, and prune monitoring and log history in bounded batches. Monitoring retention defaults to seven days and is configurable with `DEVPUSH_MONITORING_RETENTION_DAYS`.
`DEVPUSH_CRON_SECRET` is required by production Compose.

Keep `DEVPUSH_TRUST_PROXY=false` when exposing the application directly. Set it
to `true` only when a reverse proxy overwrites `X-Real-IP` or
`X-Forwarded-For`; devpush then uses that address for rate limiting and agent
address discovery. Cloudflare Workers use `CF-Connecting-IP` automatically and
ignore this setting. Direct self-hosted requests use the peer address supplied
by the server runtime and never trust client-provided forwarding headers.

The scheduler is deliberately an external HTTP caller rather than in-process
application state. VPS deployments use the Compose companion. Cloudflare
deployments use the configured Cron Trigger to invoke the same maintenance
services directly inside the Worker.

## Remote libSQL storage

Both Node and Workers support remote libSQL/Turso. Configure both database URLs
and tokens using `pnpm configure` or the environment variables in
[local setup](./local-setup.md#remote-libsql--turso). Compose passes them to the
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

To restore, stop the app, scheduler, and backup service; replace both database
files in `control_plane_data` with the selected snapshots, remove obsolete WAL
and SHM files while all connections are closed, then start the pinned image.
Do not restore over an open SQLite connection. D1 installations use D1 recovery and
export tooling separately for each database; these Docker backups cover native
SQLite only.

## Agent upgrades

Every installation creates a root-owned updater. Run it manually with:

```sh
sudo /usr/local/lib/devpush/update-agent
```

It downloads the platform binary and published SHA-256 checksum, skips an
identical binary, and drains current work before replacing a changed binary and
restarting the agent. Heartbeats continue during draining; completion reports
must be acknowledged before restart. A drain timeout postpones the update.
The command displays download, verification, drain, restart, and reconnection
phases. During draining it explains that active work and heartbeats continue.
Running containers remain up. Failed startup restores the previous binary. Set
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
`/etc/devpush/agent.env`. To connect an empty host to a different control plane,
use the [agent maintenance workflow](local-setup.md#agent-maintenance), which
enrolls a new identity and supports rollback. Moving active hosts between control
planes is not supported by that workflow.

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
