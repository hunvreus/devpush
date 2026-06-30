# Compose deployments

devpush treats the repository Compose file as the source of truth.

## Project settings

V1 supports:

- Compose file path.
- One default public route per environment.
- Production environment server selection during project creation.
- Environment variables and secrets.
- Optional release command.
- Routed HTTP readiness checks with an optional path override.
- Manual and GitHub push deployments.

## Public route

Project routes map public paths to Compose services and internal ports. Domains
and generated environment aliases provide the hostnames for those routes.

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

Generated environment aliases and custom domains point at the environment's
stable environment ID, not the editable environment slug. The slug is used for
matching branches and for readable generated hostnames.

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

The release command runs once before traffic switches.

```yaml
service: web
command: php artisan migrate --force
```

If it fails, the deployment fails and existing traffic remains on the previous
revision.

## GitHub push deployments

When the GitHub App sends a `push` webhook for a connected repository, devpush
queues a deployment for environments whose branch matches the pushed branch. If
that environment already has a queued or running deployment, the newer
deployment cancels the older in-flight deployment.

## Rollback

Rollback queues a new deployment from a previous successful deployment snapshot.
It uses the old commit, routes, Compose settings, runtime identity, and encrypted
environment variables captured on that deployment row. It does not use the
current project settings.

## Redeploy

Redeploy queues a new deployment from the selected deployment snapshot without
labeling it as a rollback. It can rerun failed, canceled, or successful
deployments, but not deployments that are already queued or running.

## Volumes

devpush relies on Docker Compose project scoping for normal named volumes.
During deployment, the agent warns about volume definitions that bypass that
scoping, such as explicit `name:` values or `external: true`.

When a project or team is deleted, devpush first deprovisions containers and
networks while retaining Compose-labeled volumes, then queues a later purge job
that removes those retained volumes after the retention window.

Managed backups are not implemented yet. The first backup model is defined in
[Backups](./backups.md).
