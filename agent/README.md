# devpush agent

The agent runs on user servers, owns Docker Compose and Traefik locally, and
connects outbound to the devpush control plane.

The agent validates configuration, registers with the devpush control
plane, sends HTTP heartbeats with host and Compose service state, polls for
queued jobs, and runs Docker Compose deploys, cleanup jobs, backups, and backup
retention cleanup locally.

Every 30-second heartbeat reports CPU, memory, root disk capacity, aggregate
non-loopback network rates, aggregate disk read/write rates, host identity and
uptime, and the latest state of
containers belonging to Compose projects. Compose state includes the service,
container state, Docker health, restart count, start time, and exit code.

Deploy execution currently does this:

- claims the oldest queued deployment for the registered server;
- clones the GitHub repository with a short-lived installation token;
- writes configured environment variables to a deployment env file;
- starts a managed `devpush-traefik` container when public routes are configured;
- writes a Compose override with Traefik labels for configured public routes;
- runs `docker compose --env-file ... -p ... -f ... -f devpush.compose.yml pull --ignore-pull-failures`;
- runs `docker compose --env-file ... -p ... -f ... -f devpush.compose.yml build`;
- optionally runs the configured release command in the routed service before services go live;
- runs `docker compose --env-file ... -p ... -f ... -f devpush.compose.yml up -d --no-build`;
- optionally checks the configured readiness path through the managed Traefik entrypoint;
- reports deploy logs, events, status, and Git SHA back to the control plane.

Each deployment job currently has a 30 minute agent-side timeout. `DOCKER_HOST`
from the agent config is passed through to Docker/Git subprocesses when set.

Backup execution currently does this:

- claims queued `backup` jobs for the registered server;
- writes `manifest.json` under the run's local backup directory;
- runs configured database dump commands with `docker compose exec -T <service> sh -lc <command>`;
- captures database dump stdout as gzip-compressed `.sql.gz` artifacts;
- archives selected Compose named volumes through a read-only helper container as `.tar.gz`;
- uploads local artifacts to S3-compatible storage with `rclone` when remote backups are enabled;
- reports local and remote artifacts, checksums, and sizes back to the control plane;
- claims queued `backup_cleanup` jobs and deletes expired local files and remote S3 objects.
- claims queued `restore` jobs, verifies selected artifact checksums, restores
  volume artifacts into target volumes, and streams database dump artifacts into
  target service restore commands.

Remote backups require `rclone` on the server. The installer attempts to install
it on apt-based hosts and warns when it is unavailable.

The control-plane installer can download the agent from
`/api/install/agent/binary` when `DEVPUSH_AGENT_BINARY_DIR` points to a
directory containing `devpush-agent-linux-amd64` and
`devpush-agent-linux-arm64` on the control-plane host. The installer detects
the server architecture and requests the matching binary.

The installer also creates `/usr/local/lib/devpush/update-agent`. This root-owned
helper verifies the published SHA-256 checksum before replacing the binary and
restarting the service. Run it manually with
`sudo /usr/local/lib/devpush/update-agent`, or enable the optional
`devpush-agent-update.timer`. The agent itself remains unprivileged.

The token in `agent.env` bootstraps enrollment. After enrollment, the agent
stores its dedicated credential at `$DEVPUSH_STATE_DIR/credential` with mode
`0600`. If that credential may have been exposed, rotate it on the host without
reinstalling anything:

```sh
sudo devpush-agent credential rotate
```

Example config:

```env
DEVPUSH_SERVER_URL=https://devpush.example.com
DEVPUSH_AGENT_TOKEN=one-time-enrollment-token
DEVPUSH_AGENT_ID=optional-existing-agent-id
DEVPUSH_STATE_DIR=/var/lib/devpush-agent
DEVPUSH_TRAEFIK_EMAIL=optional-letsencrypt-email@example.com
```

The server needs `git`, `docker`, and the Docker Compose plugin available to the
agent user. Remote backups also need `rclone`. Public routes require ports `80`
and `443` to be free for the managed Traefik container.
