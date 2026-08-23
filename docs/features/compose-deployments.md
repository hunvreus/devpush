# Compose deployments

devpush treats the repository Compose file as the source of truth.

## Project settings

V1 supports:

- Compose file path.
- Project paths mapped to Compose services and internal ports.
- A project default server selected during project creation, with optional
  per-environment overrides.
- Environment variables and secrets.
- Optional pre-deploy command.
- Optional pre-deploy service; automatic mode uses the first routed Compose
  service and falls back to the first service in the Compose file.
- Optional deployment and rollback command overrides.
- Routed HTTP readiness checks with an optional path override.
- Manual and GitHub push deployments.

## Public route

Project routes map public paths to Compose services and internal ports. Default
routes apply to every environment. An environment-scoped route with the same
path replaces the default target for that environment; a new path extends it.
Custom domains and generated nip.io aliases provide the hostnames.

```yaml
path: /
service: web
port: 3000
stripPrefix: false
```

At deployment time, devpush expands saved project routes through the hostnames
assigned to the target environment. The agent configures Traefik by writing a
generated Compose overlay. The overlay attaches routed services to the shared
`devpush-proxy` network and adds Traefik labels; the user Compose file is not
modified.

New projects suggest `/` from explicit TCP `ports` or `expose` metadata on the
default branch. Devpush selects the only declared target, or the only target on
port 80 when other ports are also declared. Ambiguous or undeclared targets do
not produce a suggestion. There is no implicit `web:3000` fallback. Projects
without routes deploy privately with no public HTTP or HTTPS ingress.

Managed ingress is always enabled. The agent resolves the exact Compose model
for the deployed commit and environment, removes every service's published
`ports` and `network_mode: host`, and reports warnings in settings and the
deployment log. Containers remain reachable to each other on their
environment-scoped Compose network; public HTTP/HTTPS traffic enters only
through Devpush's Traefik listener on ports 80/443. Route targets may use any
internal HTTP port.

The agent runs `docker compose config` before pulling or building. Required
Compose interpolation therefore fails against the exact commit with Compose's
own error, and routes targeting services absent from that commit fail with a
specific Devpush error.

## Deployment commands

Devpush pulls images, builds services, runs the optional pre-deploy command,
reconciles the stable environment runtime with
`docker compose up -d`, waits for container health, and checks the first public
route. This default does not guarantee a zero-downtime rollout.

The optional deployment command override is for projects that own their service
update procedure, such as
a stable internal Caddy service switching between blue and green application
services. Devpush prepares the exact checkout, environment file, resolved
Compose model, managed-ingress override, and images, then runs the configured
host command instead of `docker compose up`. The setting accepts either an
inline shell command or a repository script invocation such as `bash
./scripts/deploy.sh`. Rollback reuses this command with
`DEVPUSH_ACTION=rollback` unless a separate rollback command is configured. The
command receives:

- All resolved project and Devpush deployment environment variables.
- `DEVPUSH_COMPOSE_PATH` for the repository Compose file.
- `DEVPUSH_COMPOSE_OVERRIDE` for Devpush routing and ingress restrictions.
- `DEVPUSH_COMPOSE_PROJECT_NAME` for the stable environment runtime.
- `DEVPUSH_ENV_FILE` for Compose interpolation.
- `DEVPUSH_ACTION`, set to `deploy` or `rollback`.

A Compose-based script must use that contract, for example:

```sh
docker compose \
  --env-file "$DEVPUSH_ENV_FILE" \
  -p "$DEVPUSH_COMPOSE_PROJECT_NAME" \
  -f "$DEVPUSH_COMPOSE_PATH" \
  -f "$DEVPUSH_COMPOSE_OVERRIDE" \
  up -d gateway app-green
```

The script owns the application-specific service update. Devpush owns image
preparation, Compose health checks, cancellation, the configured timeout, logs,
job state, managed hostnames and TLS, and the final public route check. An
optional rollback command may switch a retained revision; without one, Devpush
runs the deployment command against the previous deployment's frozen commit and
configuration. Custom commands are trusted server configuration and are never
loaded automatically from repository files.

The effective deployment server is the environment override when present,
otherwise the project default. That resolved server is frozen on the deployment
row so later assignment changes do not alter deployment history.

The resulting routes and Compose deployment settings are frozen in the
deployment's `config`. Repository, environment, server, Git, runtime, and
lifecycle data remain queryable columns on the same deployment row; the project
is reached through the environment relationship.
Resolved environment variables are stored separately in encrypted `env_vars`.
The agent receives a job assembled from that row; it does not read mutable
project settings while executing an existing deployment.

Generated aliases and custom domains are separate records. Environment and
branch aliases move to the successful deployment; each deployment also receives
its own generated alias in the frozen route snapshot. All of them reference the
environment's stable ID, not the editable slug. The default format is
`{prefix}-{IPv4}.nip.io`, with the IPv4 octets separated by dashes. Private and
loopback aliases use HTTP. Deployment Visit actions use the deployment alias,
not the moving environment alias. V1 replaces one environment runtime in place, so
historical revision URLs are not kept active after a newer deployment succeeds.

Custom domains remain pending until a user explicitly verifies that their A
record resolves to the assigned environment server. Verification requires a
successful deployment for that environment, records the failure reason, and is
reset when the domain moves to another environment. A successful deployment by
itself does not verify DNS ownership.

If `stripPrefix` is enabled, Traefik removes the route path before forwarding
the request to the service.

## Readiness

For routed deployments, the agent checks the first public route through the
managed Traefik container before reporting success. HTTPS checks validate the
managed certificate for the public hostname. If no readiness path is
configured, it checks `/`. A custom readiness path such as `/health` overrides
that default. `2xx` and `3xx` responses count as ready.

The agent waits for Compose containers to be running and for any Docker health
checks to report `healthy`, including after a deployment command override. A
successful command is not enough by itself.

## Pre-deploy command

The optional pre-deploy command runs once after images are prepared and before
the runtime is reconciled. It is skipped during rollback. An explicitly selected
service must still exist in the deployed Compose file; otherwise the deployment
fails rather than silently choosing a different service.

```yaml
service: web
command: php artisan migrate --force
```

If it fails, the deployment fails before Compose reconciliation starts.

## GitHub push deployments

Branches are assigned to environments in their configured order. Production
matches its branch exactly; later environments may use one `*` wildcard. A
branch belongs to only the first matching environment. Environment position is
persisted explicitly so this priority remains deterministic.

The manual deploy dialog lists commits only from repository branches assigned
to the selected environment. When the GitHub App sends a `push` webhook,
devpush queues a deployment for that one matching environment. If it already
has a queued or running deployment, the newer deployment cancels the older
in-flight deployment.

## Rollback

Rollback queues a new deployment from a previous successful deployment. It uses
the old commit, routes, Compose settings, server placement, runtime identity, and
encrypted environment variables captured on that deployment row. It does not
use the current project settings.

## Redeploy

Redeploy queues a new deployment from the selected deployment record without
labeling it as a rollback. It can rerun failed, canceled, or successful
deployments, but not deployments that are already queued or running.

## Volumes

devpush relies on Docker Compose project scoping for normal named volumes.
During deployment, the agent warns about volume definitions that bypass that
scoping, such as explicit `name:` values or `external: true`.

When a project or team is deleted, devpush first deprovisions containers and
networks while retaining Compose-labeled volumes, then queues a later purge job
that removes those retained volumes after the retention window.

Managed backups are available behind a feature flag and are documented in
[Backups](./backups.md).
