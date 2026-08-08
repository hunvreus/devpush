# Compose deployments

devpush treats the repository Compose file as the source of truth.

## Project settings

V1 supports:

- Compose file path.
- Project paths mapped to Compose services and internal ports.
- A project default server selected during project creation, with optional
  per-environment overrides.
- Environment variables and secrets.
- Optional release command.
- Optional release service; automatic mode uses the first routed Compose
  service and falls back to the first service in the Compose file.
- Routed HTTP readiness checks with an optional path override.
- Manual and GitHub push deployments.

## Public route

Project routes map public paths to Compose services and internal ports. Custom
domains and generated nip.io aliases provide the hostnames for those routes.

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
loopback aliases use HTTP. V1 replaces one environment runtime in place, so
historical revision URLs are not kept active after a newer deployment succeeds.

If `stripPrefix` is enabled, Traefik removes the route path before forwarding
the request to the service.

## Readiness

For routed deployments, the agent checks the first public route through the
managed Traefik container before reporting success. If no readiness path is
configured, it checks `/`. A custom readiness path such as `/health` overrides
that default. `2xx` and `3xx` responses count as ready.

Before that route check, the agent also waits for Compose containers to be
running and for any Docker health checks to report `healthy`. A successful
`docker compose up -d` command is not enough by itself.

## Release command

The release command runs once before traffic switches. An explicitly selected
service must still exist in the deployed Compose file; otherwise the deployment
fails rather than silently choosing a different service.

```yaml
service: web
command: php artisan migrate --force
```

If it fails, the deployment fails and existing traffic remains on the previous
revision.

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
