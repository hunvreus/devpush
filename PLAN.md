# devpush reboot plan

## Gist

devpush is moving from a self-hosted deployment monolith to a control plane plus agent model.

The control plane owns users, teams, projects, GitHub integration, deployment history, logs UI, and product workflows. Agents run on user servers, own Docker Compose and Traefik locally, and connect outbound to the control plane over WebSocket.

The current FastAPI implementation lives in `legacy/` as reference material only.

## Product decisions

- Product remains `devpush`.
- Primary direction is a hosted control plane with user-installed agents.
- Keep self-hosting possible, but do not let it dominate v1 architecture.
- Teams are part of v1.
- A team can have multiple servers/agents.
- Each project deploys to exactly one server in v1.
- GitHub is the only Git provider in v1.
- New projects are Docker Compose based.
- Legacy runner/preset projects are not carried forward.
- Agent install should be a copy/paste command from the UI.
- Agent install should auto-install Docker when missing and validate an existing Docker install when present.
- Agent should run as a `devpush` system user from the start.
- Traefik is mandatory and managed by the agent in v1.
- Billing is out of scope for now.

## Repository layout

Target layout:

```text
/
  app/                 TanStack Start control plane
  agent/               Go agent
  docs/
    architecture.md
    api/
    development/
    features/
  deploy/
    compose.yml
    systemd/
  legacy/              old FastAPI app reference
```

Use the root `AGENTS.md` documentation conventions:

- `README.md`: product overview, setup, common commands, links.
- `ARCHITECTURE.md`: system mechanics, runtime shape, data flow, invariants, and non-obvious decisions.
- `TODO.md`: single unresolved-work list.
- `CHANGELOG.md`: implemented visible changes.
- `docs/index.md`: docs entrypoint.
- `docs/features/*.md`: expected product behavior and invariants.
- `docs/api/*.md`: external or agent-facing contracts.
- `docs/development/*.md`: setup, testing, migrations, safe change workflows.

## Stack

Control plane:

- TanStack Start
- TanStack Query
- Better Auth
- shadcn/ui
- Postgres
- Drizzle
- Valkey

Agent:

- Go
- SQLite for local agent state
- Local encrypted secret storage
- Docker Compose via Docker CLI or SDK
- Managed Traefik
- Outbound WebSocket protocol

Deployment target:

- Regular server deployment first, likely Hetzner.
- No Cloudflare Durable Objects dependency.

## State split

Postgres is the source of truth:

- users
- teams
- projects
- servers/agents
- deployments
- durable deploy log chunks
- audit/history
- GitHub installation metadata
- config and secret metadata

Valkey is coordination infrastructure:

- job queue
- delayed retries
- cancellation signals
- transient agent presence
- short-lived locks
- rate limits/debounce
- runtime log fanout
- webhook burst smoothing

Valkey must not be the only store for important history. If Valkey is down, deploy work may pause, but durable project/deployment history remains in Postgres.

## Agent protocol model

Agent connection:

```text
agent -> control plane WebSocket
control plane authenticates agent token
agent sends hello/version/capabilities
control plane records presence
```

Deploy job:

```text
GitHub webhook or user action
control plane creates deploy job
job targets one agent/server
agent receives signed job
agent syncs required config/secrets version
agent fetches repo with short-lived GitHub token
agent runs docker compose
agent streams deploy logs with sequence numbers
agent reports status and health
```

Deploy logs:

```text
agent sends chunks with deployment_id + stream + seq
control plane stores chunks durably in Postgres
control plane ACKs persisted seq
agent retries unacked chunks after reconnect
central dedupes by deployment_id + stream + seq
```

Runtime logs:

```text
browser opens logs view
control plane asks agent to stream docker logs
agent streams on demand over WebSocket
control plane relays to browser
stream is cancelled when UI closes
```

Runtime logs are not centrally persisted in v1.

## Secrets and GitHub access

Secrets:

- User edits secret/env value in control plane.
- Control plane sends updated encrypted payload to the relevant agent.
- Agent stores resolved values locally.
- Agent ACKs config/secret version.
- Deploy jobs reference exact config and secret versions.
- If agent has not ACKed the required version, the deploy waits or fails explicitly.

GitHub:

- Use GitHub App installation tokens.
- Generate tokens only when an agent needs repo access.
- Scope tokens to the required repositories and read-only contents permissions where possible.
- Agent may cache token in memory until expiry.
- Do not send broad installation credentials or long-lived GitHub secrets to agents.

## Routing and TLS

The agent manages Traefik on the server.

V1 assumptions:

- User does not bring their own reverse proxy.
- Project route config maps one or more public hostnames/routes to Compose services and ports.
- Agent writes Compose overrides or Traefik dynamic config.
- Custom domain HTTPS should use Traefik/Let's Encrypt.
- Hosted devpush should use a devpush-owned wildcard domain.
- Self-hosted/local devpush can use an `sslip.io` style domain, but HTTPS behavior needs validation.
- Default generated hostnames should fit a single wildcard level.
- Deployment names and default hostnames need a short scheme that identifies server, project, and deployment without requiring sub-subdomains.

## Single-server/self-host mode

Keep the agent boundary even when control plane and agent run on the same machine.

```text
self-hosted server:
  app + postgres + valkey
  agent connects to ws://localhost
  agent owns Docker/Compose/Traefik
```

Do not add a special local-Docker path inside the control plane.

## MVP scope

Core v1:

- team management
- multiple servers/agents per team
- copy/paste agent install command
- GitHub App connection
- Compose project creation
- Compose file path configuration
- bind project to one server
- configure public route service/port
- env/secrets sync
- manual deploy
- GitHub webhook deploy
- deployment status/history
- reliable deploy logs
- live runtime logs
- basic health/status
- redeploy latest
- blue-green style deployment for routed public services where possible
- rollback/redeploy previous revision using Git SHA plus config/secret version snapshots

Not v1:

- billing
- Kubernetes
- Helm
- Nixpacks/buildpacks
- SSH-based server management
- user-provided reverse proxy
- full observability platform
- centralized runtime log retention/search
- vulnerability scanning/security product
- database backup automation
- multi-Git provider support

## Spike apps

Use these cases to validate the model:

1. Simple web app: one service, one public port.
2. API app with env vars/secrets: one public route.
3. Multi-service app: web + postgres + redis/worker, only web public.
4. Optional: two public routes, such as web and admin.

## First implementation slices

1. Scaffold the new repo shape:
   - `app/`
   - `agent/`
   - `docs/`
   - `deploy/`
   - root `README.md`, `ARCHITECTURE.md`, `TODO.md`, `CHANGELOG.md`

2. Scaffold the control plane:
   - TanStack Start
   - shadcn/ui
   - Drizzle/Postgres
   - Better Auth
   - Valkey client
   - basic team/project/server schema

3. Scaffold the agent:
   - Go module
   - config file
   - systemd-ready binary shape
   - connect outbound to control plane
   - hello/heartbeat/status protocol

4. Define protocol docs:
   - agent auth
   - connection lifecycle
   - job messages
   - log chunk ACKs
   - config/secret version ACKs
   - cancellation

5. Implement server registration:
   - create server in UI
   - generate one-time install token
   - install command registers agent
   - server appears online/offline

6. Implement first deploy path:
   - create Compose project from GitHub repo
   - bind to server
   - configure service/port route
   - send deploy job
   - agent fetches repo
   - agent runs Compose
   - stream and persist deploy logs
   - show status in UI

7. Implement blue-green routing:
   - deploy each public revision under a unique Compose project or service identity
   - wait for container health and route readiness
   - switch Traefik routing only after the new revision is healthy
   - keep the previous routed revision until the new revision succeeds
   - garbage collect old revisions after retention limits

## Resolved decisions

- Install script auto-installs Docker when missing and validates existing Docker installs.
- Agent runs as a `devpush` system user from v1.
- Compose files come from the Git repository only.
- Users can configure the Compose file path/name. If unset, devpush detects common defaults.
- Hosted default domains use a devpush-owned wildcard domain.
- Self-hosted/local default domains can use `sslip.io` with exact per-host certificates.
- `sslip.io` does not support wildcard certificates.
- Rollback target is previous Git SHA plus config/secret version snapshot.
- Blue-green routing is a v1 product goal for public routed services.
- Single central app instance is acceptable for v1.

## Open questions

- What exact default hostname format identifies server, project, and deployment while staying within one wildcard label?
- How much blue-green support is possible for arbitrary Compose apps with stateful services, workers, and fixed container names?
- Should blue-green apply only to routed public services while dependencies are shared/stable?
- What retention limits should apply to old blue-green revisions?
- What local secret encryption mechanism should the agent use?

## Current recommendations

- Hostname labels should stay under 63 ASCII characters. Reserve room for generated suffixes and keep the default label around 40 characters.
- Hosted hostname format should use one wildcard label, for example `{project}-{server}-{hash}.devpush.app`.
- `sslip.io` self-host hostnames should use exact host certificates via HTTP-01, not wildcard certificates.
- Blue-green should be implemented by running revision-specific routed services, switching Traefik after health passes, and retiring old routed services after a grace period.
- Blue-green should not restart databases by default.
- Old routed revisions should default to retaining one previous revision for 30 minutes, with cleanup after successful deploy.
- Agent secret values should be encrypted locally with XChaCha20-Poly1305 or AES-256-GCM using a random install-time key stored as `0600` under the `devpush` user.
- Agent SQLite should store secret metadata, versions, key names, checksums, and sync state; encrypted values can be stored either in SQLite blobs or in an encrypted file store. Prefer SQLite blobs first for transactional versioning.

## Compose deployment best practices

devpush should make the expert Compose deployment path native rather than inventing a new application spec.

### Release commands

Compose has no standard release phase. devpush should provide one as deployment behavior, not as a required repo-specific file.

V1 model:

- Optional release command stored in devpush project/environment settings.
- User selects the Compose service used to run the command.
- Agent runs it once with `docker compose run --rm --no-deps <service> <command>` or an equivalent isolated one-off container.
- Release command runs before traffic switches.
- Failed release command fails the deploy and leaves existing routed services untouched.
- V1 should support one release command. Multiple ordered commands can be added later if real apps need them.

Use cases:

- database migrations
- asset collection
- cache warming/invalidation
- one-time setup that must happen before new traffic

### Migrations

devpush should support migrations, but it must not pretend destructive database changes are automatically reversible.

Recommended migration model:

- Prefer backward-compatible expand/contract migrations.
- Additive changes happen first.
- New app version must work with old and new schema during the rollout window.
- Destructive changes happen in a later deploy after old revisions are retired.
- App-startup migrations are allowed, but devpush should mark rollback safety as unknown.

Unsafe migrations:

- dropping columns used by the current live app
- renaming tables/columns without compatibility views or dual-read logic
- destructive data transforms without a backup and a tested reverse path

### Zero-downtime deploys

devpush should follow the Dokku/Kamal class of safe deployment mechanics:

- Keep stable public hostnames.
- Start new routed service revisions behind the proxy.
- Wait for Docker healthchecks or devpush HTTP checks.
- Switch Traefik routing only after the new revision is healthy.
- Keep the previous routed revision for a grace period.
- Retire old routed services after the grace period.

Fixed host-published ports and stateful services cannot be guaranteed zero-downtime. devpush should steer public traffic through Traefik-managed routes instead.

### Rollbacks

Rollback should be explicit about what is safe.

Fast rollback:

- If the previous routed revision is still retained, switch Traefik back to it.

Redeploy rollback:

- If the previous revision has been garbage collected, redeploy the previous Git SHA plus config/secret version snapshot.

Database-aware rollback:

- If a release command ran, rollback safety depends on whether the migration was backward-compatible.
- V1 should not auto-run destructive database rollback commands.
- Later versions can support an optional rollback command, but the UI must still treat it as operator-owned risk.

### Health and readiness

devpush should prefer existing Compose `healthcheck` definitions. If absent, devpush should allow a simple HTTP readiness check per public route.

devpush should use Compose dependency metadata when present:

- `depends_on`
- `condition: service_healthy`
- service health status from Docker

Healthchecks are the gate for traffic switching, not just a status badge.

V1 readiness defaults:

- If the routed service has a Compose `healthcheck`, use it.
- If not, and the route is HTTP, try the route path with a short timeout.
- If neither works, fall back to container running state with a warning that zero-downtime confidence is lower.

### Dependencies and state

Blue-green should apply to routed services first.

Databases, Redis, queues, and volumes stay under stable identities unless the user explicitly opts into changing them. This avoids accidentally creating duplicate stateful dependencies during every app deploy.

## Compose-native project settings

V1 should keep settings narrow:

- Compose file path.
- Public routes: which service and port are exposed publicly.
- Auto-deploy trigger: branch push or manual only.
- Watch paths: optional path filters for monorepos.
- Environment variables and secrets.
- Optional release command.
- Optional readiness override.

Avoid v1 support for:

- build type selection
- Nixpacks/buildpacks/static app builders
- raw Compose editing in devpush
- arbitrary pre/post deployment hooks
- separate first-class database resources outside Compose

These features broaden the product into Dokploy/Coolify territory and weaken the Compose-native story.
