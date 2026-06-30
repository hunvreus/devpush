# devpush agent

The agent runs on user servers, owns Docker Compose and Traefik locally, and
connects outbound to the devpush control plane.

The current MVP agent validates configuration, registers with the devpush control
plane, sends HTTP heartbeats with host metrics, polls for queued deployment
jobs, and runs a basic Docker Compose deploy locally.

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

The control-plane installer can download the agent from
`/api/install/agent/binary` when `DEVPUSH_AGENT_BINARY_DIR` points to a
directory containing `devpush-agent-linux-amd64` and
`devpush-agent-linux-arm64` on the control-plane host. The installer detects
the server architecture and requests the matching binary.

Still TODO: redeploying the same snapshot without labeling it as rollback and
local retention cleanup for accepted job payloads.

Example config:

```env
DEVPUSH_SERVER_URL=https://devpush.app
DEVPUSH_AGENT_TOKEN=one-time-or-rotated-agent-token
DEVPUSH_AGENT_ID=optional-existing-agent-id
DEVPUSH_STATE_DIR=/var/lib/devpush-agent
DEVPUSH_TRAEFIK_EMAIL=optional-letsencrypt-email@example.com
```

The server needs `git`, `docker`, and the Docker Compose plugin available to the
agent user. Public routes require ports `80` and `443` to be free for the
managed Traefik container.
