---
description: Prepare a Compose application, configure routes and understand deployment results.
---

# Compose deployments

devpush uses the Compose file in your GitHub repository to build and run your app.
It can build services from Dockerfiles or pull existing container images.
You still need a Compose file: Dockerfile-only projects and Docker Swarm are not supported.

## Prepare your Compose file

Choose the repository-relative file path in **Project settings → Build & Deploy**.
For example, `compose.yml` at the repository root. If no path is supplied,
devpush looks for `compose.yml`, `compose.yaml`, `docker-compose.yml`, then
`docker-compose.yaml` at the repository root. devpush reads the file from
the commit being deployed, not necessarily the repository's current default branch.

- Supply required interpolation variables in **Environment variables**.
- Have HTTP services listen on their container's network interface, not only loopback.
- Use named volumes for persistent data and define health checks where possible.
- Choose service images compatible with the server's CPU architecture.

See the [example app](https://github.com/hunvreus/devpush/tree/main/examples/compose-web)
for a small working repository layout.

## Pass variables to your app

Saved devpush variables are available for Compose interpolation. They are **not**
automatically injected into every container or Docker build. Reference the values
your service needs in its Compose file:

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

Set both variables in devpush's **Environment variables** section. The build
argument must also be consumed by the Dockerfile; the `environment` entry passes
the database URL to the running service. Do not put private secrets into public
build arguments or client-side bundles.

## Public route

In **Project settings → Routes**, add a route for each public HTTP target:

| Field | Example | Meaning |
| --- | --- | --- |
| Scope | All environments | Apply everywhere, or choose one environment. |
| Path | `/` | URL path to match. |
| Service | `web` | Service name in the Compose file. |
| Port | `3000` | The port the app listens on **inside** its container. |
| Strip route prefix | Off | Enable if the app should receive the URL without the matched prefix. |

For example, path `/api` with stripping enabled forwards `/api/users` as `/users`.
Without stripping, the service receives `/api/users`.

An environment route replaces an all-environment route with the same path.
A different path adds another route. A missing route means no devpush-managed
public HTTP access; services can still communicate on their Compose network.

New projects suggest a route only when the repository declares an unambiguous
TCP target through `ports` or `expose`. If several targets are declared, a route is suggested only when exactly one
uses port 80. Otherwise, add the route yourself.
There is no assumed `web:3000` target.

### Published ports and host networking

The agent manages public ingress with Traefik. It removes service `ports` mappings
and `network_mode: host` from the resolved deployment configuration, and reports
warnings. Public HTTP traffic enters through Traefik on ports 80/443; services
remain connected internally through their environment's Compose network.

This means a Compose file that publishes a raw database or other non-HTTP port
will not expose it that way through devpush. Configure HTTP routes explicitly.
The repository file itself is not modified: devpush supplies a generated overlay.

Use [Domains and HTTPS](/docs/domains/) for generated addresses, custom DNS and certificates.

## What happens during deployment

1. The agent downloads the selected commit and resolves its Compose configuration.
2. It pulls or builds images.
3. It runs the optional pre-deploy command.
4. It updates the environment with `docker compose up -d`.
5. It waits for containers, health checks and public route readiness.

Deployment uses the settings and encrypted variables saved when it was queued.
Editing project settings does not alter a job already queued. Each environment
uses a stable Compose runtime: a new deployment updates it in place rather than
keeping every older revision running. Zero downtime is not guaranteed.

Most projects need no custom commands. For database migrations or an app-specific
release procedure, see [Deployment commands](/docs/deployment-commands/).

## Readiness

The agent waits for containers to run and configured Docker health checks to
report `healthy`. For routed services, it also requests every distinct public
route through Traefik and validates HTTPS certificates.

Set **Health check path** in Build & Deploy to an endpoint such as `/health`.
If unset, devpush checks `/`. A route prefix is included: route `/api` and health
path `/health` checks `/api/health` before any configured prefix stripping.
HTTP `2xx` and `3xx` responses count as ready.
Certificate issuance may take several seconds on the first deployment even when
the container has already started. The agent currently allows about 60 seconds
for Compose container health and about 30 seconds per distinct public route.
These readiness windows are separate from the three-hour deployment deadline;
a longer custom-command timeout does not extend them.

A failed deployment can have changed containers or data before failing. Inspect
application health and logs before retrying; a failed result does not imply that
all earlier steps were undone.

## GitHub push deployments

A branch deploys to the first matching environment. Production matches its branch
exactly; later environments can use one `*` wildcard. See
[Environments and variables](/docs/projects/#environments-and-variables).

A push to a matching branch queues a deployment. A newer admitted deployment
cancels an older queued or running deployment for that environment. A push blocked
by a disconnected server or incompatible agent records a failure without canceling
existing work. Manual deployment chooses from branches assigned to the environment.

Renaming a repository within its GitHub App installation keeps push matching.
Moving it to another installation requires reconnecting the project. If pushes
stop arriving, check GitHub webhook delivery and the dashboard's public origin.

## Logs and failed deployments

Use **Deployments → deployment → Logs** for checkout, image build and deployment
progress. Use the project's **Logs** page for output from running services.

| Failure | What to check |
| --- | --- |
| Missing interpolation variable | Add its value under Environment variables, then deploy again. |
| Route service is absent | Check the service name in the deployed commit's Compose file. |
| Container is unhealthy | Inspect its health check and application logs. |
| Route readiness fails | Check the app's internal HTTP port, listening address and health check path. |
| TLS readiness fails | Check DNS, ports 80/443 and certificate messages. |
| Server disconnects | Restore agent connectivity before retrying. |

A running deployment fails after ten minutes without a server heartbeat or the
three-hour execution limit. Log-read failures are separate: a successful deployment
can temporarily have unavailable logs.

## Rollback

Open a previous successful deployment and choose **Rollback**. This queues a new
deployment using its saved commit, runtime settings and encrypted variables.
Public routes and domains come from **current** project settings, so their service
names and ports must still exist in the older Compose file.

Rollback does not restore database writes or volume contents. Use
[Backups](/docs/backups/) for data recovery. Replay is rejected if the environment
has moved to a different server since the selected deployment.

## Redeploy

**Redeploy** reruns a selected successful, failed or canceled deployment using its
recorded commit, variables and runtime settings with current routing. Pre-deploy
commands run on redeploy, including before a custom deployment command. It does
not label the new attempt as a rollback. Queued or running attempts cannot be redeployed.

## Volumes and deletion

Use normal Compose-scoped named volumes for persistence. Explicit volume `name:`
values and `external: true` bypass normal scoping; the agent warns about them.
Bind mounts can keep old checkout directories on disk. See
[Host trust and checkout retention](/docs/deployment-commands/#host-trust-and-checkout-retention).

When project deletion removes runtimes, devpush first removes containers and
networks, then retains managed volumes for seven days before purging them.
Keeping runtimes deliberately leaves their containers running and their hostnames
reserved. Manual container removal does not itself release those reservations.
Team deletion also queues runtime cleanup. External backup archives are not
automatically removed.

Set up [application backups](/docs/backups/) before relying on rollback or deletion
retention as a recovery plan. Operators can inspect failed cleanup through
[deletion recovery](/docs/deletion-recovery/).
