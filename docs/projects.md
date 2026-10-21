---
description: Configure a project's repository, branches, variables and deployment server.
---

# Projects and environments

A project connects a GitHub repository to your servers. Its **Settings** page
controls the Compose file, environments, variables, server assignments, routes
and domains. For your first project, follow [Getting started](/docs/getting-started/).

## Create and configure a project

Choose **New project**, select a repository available to the configured GitHub App,
and review its name, server and Compose settings. Creating a project does not
start a deployment; use **Deploy** when you are ready.

An explicit Compose path takes priority over automatic root-file detection.
Check the path if your file lives in a subdirectory or has a different name.
If a repository is missing, check its GitHub App installation and your GitHub
access. Reconnect GitHub from Account settings when credentials cannot be refreshed.

Settings sections save separately, but share concurrent-save protection. If someone
changes another section while you edit, your save can be rejected. See
[Concurrent settings changes](/docs/accounts-and-teams/#concurrent-settings-changes).

## Environments and variables

An environment lets a branch use its own variables and server assignment.
Production is created with the repository's default branch. Add environments in
**Settings → Environments**.

| Example | Branch rule | Result |
| --- | --- | --- |
| Production | `main` | Commits on `main` deploy to Production. |
| Staging | `staging` | Commits on `staging` deploy to Staging. |
| Preview | `feature/*` | Matching feature branches deploy to the same Preview environment. |

Rules are evaluated in their saved order; only the first match is used. Production
uses an exact branch name; other environments can use one `*` wildcard. A wildcard
rule does **not** create a separate environment for each matching branch. Matching
branches update the same environment runtime. A newer admitted deployment cancels
an older queued/running attempt for that environment, even if it came from another
matching branch.

In **Environment variables**, add values for all environments or choose one specific
environment. A scoped value overrides the all-environment value with the same name.
Reference the variables in your Compose file, save, then deploy again. See
[Pass variables to your app](/docs/compose-deployments/#pass-variables-to-your-app)
for the build/runtime distinction.

Values are encrypted in the database and captured when a deployment is queued.
Avoid putting secrets in Compose files, build output or browser bundles.
Changing an environment's display name does not replace its runtime or named volumes.

## Choose deployment servers

Set a project default in **Settings → Servers**. An environment can override it;
otherwise it uses the default. The chosen server must belong to the team and be
connected with an agent compatible with the job.

Changing the server assignment does not migrate containers, volumes or databases.
Plan data transfer separately. Old deployments retain their recorded server;
rollback to a different server is rejected.

## Routes and domains

A route maps a public URL path to a Compose service and its internal HTTP port.
All-environment routes apply everywhere; a route for one environment replaces
the same path or adds another path.

See [Compose deployments](/docs/compose-deployments/#public-route) to configure
routes and [Domains and HTTPS](/docs/domains/) to connect a hostname. Projects
without routes have no devpush-managed public HTTP endpoint.

## Inspect or restore a deployment

- **Deployments** shows attempts, build logs and actions such as Deploy, Redeploy
  and Rollback.
- **Logs** shows output from running application services.
- **Backups** protects persistent data when enabled by the installation operator.

[Rollback](/docs/compose-deployments/#rollback) uses an older commit and saved
settings with current routes. It does not restore databases or volume contents.
Configure [Backups](/docs/backups/) separately.
