---
description: Configure environments, variables and deployment servers.
---

# Projects and environments

A project connects a GitHub repository to your servers. Its **Settings** page holds the Compose path, environments, variables, server assignments, routes and domains.

Creating a project does not deploy it. For the first deployment, follow [Your first deployment](/docs/getting-started/).

## Environments

Production starts with the repository's default branch. Add more environments in **Settings → Environments**.

| Environment | Branch rule |
| --- | --- |
| Production | `main` |
| Staging | `staging` |
| Preview | `feature/*` |

Rules are evaluated in saved order; only the first match is used. Production requires an exact branch; other environments accept one `*`. A wildcard updates **one shared environment**, not a separate app per branch. A newly queued deployment cancels the previous queued/running attempt for that environment.

The project overview lists active environments. On a current deployment, use the menu beside **Visit** to open its deployment, branch and environment URLs.

## Variables

Add variables for all environments or a specific one. An environment-specific value overrides the shared value with the same name. Reference variables explicitly in your [Compose file](/docs/compose-deployments/#variables).

Values are encrypted and captured when a deployment is queued. Later edits affect new deployments, not queued work. Redeploy and rollback reuse recorded values; start a new deployment to apply edits. Keep secrets out of repository files, build output and browser bundles.

## Servers

Choose a project default in **Settings → Servers**, with optional per-environment overrides. The server must belong to the team and have a connected, compatible agent.

Changing this assignment does not move containers or data. Transfer persistent data separately; rollback to a deployment on another server is rejected.

## Routes and saved settings

[Routes](/docs/compose-deployments/#routes) map HTTP paths to Compose services. [Domains](/docs/domains/) give them hostnames. Changes take effect on the next deployment.

Settings sections save independently but share a project version. If another change makes your draft stale, devpush preserves your edits and asks you to reload. Copy anything you need before reloading; there is no automatic merge.
