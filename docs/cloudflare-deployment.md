---
description: Install the dashboard on Cloudflare Workers.
---

# Install on Cloudflare

You need a source checkout, Node.js 22.12+, pnpm 10.17+ and a Cloudflare account. Applications run on separate Linux servers.

## Configure

```sh
pnpm install --frozen-lockfile
pnpm --dir app exec wrangler login
pnpm configure
```

Choose **Cloudflare Workers** and review the intended account. Setup selects a `workers.dev` URL or a custom domain, configures sign-in/GitHub and offers two D1 databases or existing remote libSQL databases. It asks before creating resources; it does not deploy.

A custom domain's zone must be active in that account without a conflicting record. Set the final public URL before enrolling servers.

Setup writes ignored files:

- `app/wrangler.jsonc`: Worker, public variables and resource bindings.
- `app/.cloudflare-secrets.json`: secrets uploaded with deployment.

Review [authentication and secrets](/docs/configuration/), including `DEVPUSH_ADMIN_EMAIL`. Add Google credentials manually if using Google sign-in. Keep both authentication/encryption secrets stable.

R2 is optional and only enables image uploads. Without storage, provider avatars and generated fallbacks work. Keep the template's Durable Object migration and native cron; built-in scheduling needs no cron secret.

For project backups, set `DEVPUSH_BACKUPS_ENABLED=true` in secrets and export `VITE_DEVPUSH_BACKUPS_ENABLED=true` for **every build**.

## Deploy

```sh
pnpm validate:cloudflare
pnpm deploy:cloudflare
```

Validation builds without changing production. Deployment validates the configuration, migrates both databases, builds and deploys the Worker with its secrets. Confirm the account, Worker, database IDs and origin before running it. Placeholder IDs from `wrangler.template.jsonc` are not deployable.

Check `/api/health`, sign in and test an application deployment. Update separately configured OAuth callbacks to the public origin. Test uploads only when storage is enabled.

## Updates and recovery

For D1, follow [Cloudflare’s Time Travel and backup guide](https://developers.cloudflare.com/d1/reference/time-travel/) for **both** databases before upgrading. For libSQL, use provider backups. Then check out the reviewed revision, install dependencies and deploy again. Migrations are forward-only: rolling back the Worker does not roll back its databases.

Re-run setup to change resources or the origin; existing resources can be selected. Interrupted provisioning resumes from `app/wrangler.pending.jsonc`. Changing database bindings does not move data. Remote libSQL requires two distinct existing URLs and provider backups; see [Configuration](/docs/configuration/#databases).

For local D1 migrations only:

```sh
pnpm --dir app db:migrate:cloudflare --local
```

`--local` is rejected in remote libSQL mode. `DEVPUSH_WRANGLER_CONFIG` and `DEVPUSH_CLOUDFLARE_SECRETS_FILE` select alternative deployment files.

When moving the same installation to a new origin, preserve databases/keys, update provider callbacks and each agent's `/etc/devpush/agent.env`, then restart agents. Keep the old endpoint until they reconnect. A different installation requires [empty-server switching](/docs/agent-maintenance/#switch-an-empty-server), not a URL edit.
