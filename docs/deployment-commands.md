---
description: Run pre-deploy migrations or provide a custom deployment and rollback command.
---

# Deployment commands

Most apps should use the default Compose deployment. Configure these optional
commands in **Project settings → Build & Deploy** only when your app needs them.
Changing deployment and rollback host commands requires a team owner or admin.
Team members who can edit project settings may configure the pre-deploy command;
it runs inside the selected Compose service rather than as a host shell override.

## Pre-deploy command

Use a pre-deploy command for a one-time task such as a database migration.
Select its Compose service and command, for example service `web` with:

```sh
php artisan migrate --force
```

The command runs after images are ready and before services are updated. A failure
stops deployment before the update. It is skipped during rollback. An explicitly
selected service must exist in the deployed Compose file.

A migration can still modify data before failing. Rolling back application code
does not undo database changes; plan compatible migrations and backups separately.

## Custom deployment and rollback commands

The optional deployment command override is for projects that own their service
update procedure, such as
a stable internal Caddy service switching between blue and green application
services. devpush prepares the exact checkout, environment file, resolved
Compose model, managed-ingress override, and images, then runs the configured
host command instead of `docker compose up`. The setting accepts either an
inline shell command or a repository script invocation such as `bash
./scripts/deploy.sh`. Rollback reuses this command with
`DEVPUSH_ACTION=rollback` unless a separate rollback command is configured. The
command receives:

- All resolved project and devpush deployment environment variables.
- `DEVPUSH_COMPOSE_PATH` for the repository Compose file.
- `DEVPUSH_COMPOSE_OVERRIDE` for devpush routing and ingress restrictions.
- `DEVPUSH_COMPOSE_PROJECT_NAME` for the stable environment runtime.
- `DEVPUSH_ENV_FILE` for Compose interpolation.
- `DEVPUSH_ACTION`, set to `deploy` or `rollback`.

`DEVPUSH_ENV_FILE` uses Compose dotenv quoting and is passed with `--env-file`.
Do not source it as a shell script; lifecycle commands already receive the raw
variables in their process environment.

A Compose-based script must use that contract, for example:

```sh
docker compose \
  --env-file "$DEVPUSH_ENV_FILE" \
  -p "$DEVPUSH_COMPOSE_PROJECT_NAME" \
  -f "$DEVPUSH_COMPOSE_PATH" \
  -f "$DEVPUSH_COMPOSE_OVERRIDE" \
  up -d gateway app-green
```

The script owns the application-specific service update. devpush owns image
preparation, Compose health checks, cancellation, the configured timeout, logs,
job state, managed hostnames and TLS, and the final public route checks. An
optional rollback command may switch a retained revision; without one, devpush
runs the deployment command against the selected commit and runtime settings.
Historical replay uses current routing, which must still target services present
in that commit. Custom commands are trusted server configuration and are never
loaded automatically from repository files.


## Timeouts and readiness

Host commands default to 1,800 seconds, configurable from 60 to 7,200 seconds.
The whole deployment has a separate three-hour deadline. Passing the command
is not enough: devpush still waits for containers and configured health checks,
then checks public routes. See [Readiness](/docs/compose-deployments/#readiness).

## Host trust and checkout retention

Anyone who can push to a deployed branch must be trusted with the entire target
server. Compose services can request privileged access or bind mount host files
and the Docker socket. Projects on the same server are not a security boundary;
use separate servers for mutually untrusted repositories. The agent warns from
the resolved Compose model about privileged services and host bind mounts, so
YAML aliases and flow syntax do not bypass those diagnostics. These are warnings,
not a sandbox policy.

GitHub installation tokens are scoped to GitHub in the Git child process
environment, never in clone arguments or the saved origin URL. Cleanup also
removes token-bearing origin URLs left by older agents. Existing image layers
built by older agents must be rebuilt to remove embedded checkout credentials.

After deployment and runtime deprovisioning, the agent prunes unused checkouts
and their plaintext env files. It retains the successful current checkout and
any checkout referenced by container bind mounts or Compose configuration labels,
including stopped containers. Failed checkouts without container references are
removed. A bind mount of the deployment-state parent directory retains its
children. Docker inventory or inspection failure prevents deletion. Retained
bind mounts can therefore consume disk indefinitely; use named volumes for
persistent data. Custom commands must put non-container artifacts they want to
retain outside the deployment checkout. Rollback jobs fetch a fresh checkout.

