---
description: Prepare Compose apps, routes and deployment commands.
---

# Compose deployments

devpush builds or pulls the services in your repository's Compose file. Dockerfile-only projects and Swarm are not supported.

Set the repository-relative path in **Settings → Build & Deploy**. Otherwise, devpush searches the root for `compose.yml`, `compose.yaml`, `docker-compose.yml`, then `docker-compose.yaml`.

## Variables

Saved variables are available for Compose interpolation. They are not automatically injected into containers or builds:

```yaml
services:
  web:
    build:
      context: .
      args:
        PUBLIC_API_URL: ${PUBLIC_API_URL}
    environment:
      DATABASE_URL: ${DATABASE_URL}
    expose:
      - "3000"
```

Set these values in devpush. The Dockerfile must consume build arguments. Never put private secrets into public build arguments.

## Routes

In **Settings → Routes**, map a path such as `/` to service `web`, internal port `3000`. The app must listen on its container's network interface, not only localhost.

Routes can apply to all environments or one environment; a scoped route replaces the shared route with the same path. Prefix stripping forwards `/api/users` as `/users` for a route at `/api`.

The agent removes published `ports` and `network_mode: host` from its resolved configuration. Public HTTP goes through Traefik on ports 80/443; raw database ports are not exposed this way. Your repository file is unchanged.

## Deployment and readiness

The agent checks out the selected commit, prepares images, runs any pre-deploy command, updates Compose services and checks readiness. Each environment uses one stable Compose runtime. Updates happen in place; zero downtime is not guaranteed.

Set **Health check path** to your app's endpoint, such as `/health`; otherwise `/` is used. Docker health checks must pass, and routed services must return HTTP 2xx/3xx through Traefik with valid HTTPS when enabled. The route prefix is included in that request.

A failed deployment may already have changed containers or data. Inspect deployment logs and application health before retrying.

Deployment logs contain agent output. devpush labels its own log-limit notice with `[devpush]`; truncated lines are marked inline. A deployment that waits too long for an agent fails before it starts. The default queue limit is 24 hours and can be changed in [configuration](/docs/configuration/).

## Deployment commands

Use **Pre-deploy command** for tasks such as `php artisan migrate --force`, selecting the service that contains the tools. It runs after image preparation and before service updates, and is skipped during rollback. A failure stops the deployment; it does not undo database writes.

Owners/admins can replace the host deployment command and optionally the rollback command. Custom commands receive resolved variables and these paths:

- `DEVPUSH_COMPOSE_PATH`: repository Compose file.
- `DEVPUSH_COMPOSE_OVERRIDE`: managed routing/restrictions.
- `DEVPUSH_COMPOSE_PROJECT_NAME`: environment runtime.
- `DEVPUSH_ENV_FILE`: interpolation values; do not source it as shell code.
- `DEVPUSH_ACTION`: `deploy` or `rollback`.

A custom Compose command must include the managed override:

```sh
docker compose --env-file "$DEVPUSH_ENV_FILE" \
  -p "$DEVPUSH_COMPOSE_PROJECT_NAME" \
  -f "$DEVPUSH_COMPOSE_PATH" -f "$DEVPUSH_COMPOSE_OVERRIDE" up -d
```

Without a rollback override, rollback uses the deployment command. devpush still handles logs and readiness checks. Host commands default to 1,800 seconds, configurable from 60–7,200; the entire deployment has a three-hour deadline.

## Redeploy and rollback

**Redeploy** creates another attempt from a recorded commit and recorded runtime settings/variables. **Rollback** does the same from a successful deployment, skipping pre-deploy commands. Both use current routes and require the environment to remain on the recorded server. GitHub must still be able to provide the commit.

Neither restores databases or volume contents. Configure [backups](/docs/backups/) for data recovery.

## Persistent data and deletion

Use Compose-scoped named volumes. External volumes, explicit global volume names and host bind mounts can escape environment scoping. Bind mounts may also keep old checkouts on disk indefinitely.

Deleting a project can remove its containers/networks, with managed volumes retained for seven days before purge. Choosing to keep runtimes leaves applications running and hostnames reserved. External backup archives are not automatically deleted. See [blocked deletion recovery](/docs/deletion-recovery/).
