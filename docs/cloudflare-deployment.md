---
description: Install the dashboard on Cloudflare Workers.
---

# Install on Cloudflare

You need Node.js 22.12+, npm and a Cloudflare account. Applications run on separate Linux servers.

## Configure

```sh
npx devpush@latest init my-devpush --target cloudflare
cd my-devpush
```

Review the intended Cloudflare account. Setup selects a `workers.dev` URL or a custom domain, configures sign-in/GitHub and offers two D1 databases or existing remote libSQL databases. It asks before creating resources and offers to build and deploy afterward.

A custom domain's zone must be active in that account without a conflicting record. Set the final public URL before enrolling servers.

Setup writes ignored files:

- `wrangler.jsonc`: Worker, public variables and resource bindings.
- `.cloudflare-secrets.json`: secrets uploaded with deployment.

Review [authentication and secrets](/docs/configuration/), including `DEVPUSH_ADMIN_EMAIL`. Add Google credentials manually if using Google sign-in. Keep both authentication/encryption secrets stable.

R2 is optional and only enables image uploads. Without storage, provider avatars and generated fallbacks work. Keep the template's Durable Object migration and native cron; built-in scheduling needs no cron secret.

For project backups, set `DEVPUSH_BACKUPS_ENABLED=true` in secrets and export `VITE_DEVPUSH_BACKUPS_ENABLED=true` for **every build**.

## Deploy

If you declined deployment during setup, run:

```sh
npm run deploy
```

Deployment builds the application, migrates both databases and deploys the Worker with its secrets. Confirm the account, Worker, database IDs and origin before running it. Placeholder IDs from `wrangler.template.jsonc` are not deployable.

Check `/api/health`, sign in and test an application deployment. Update separately configured OAuth callbacks to the public origin. Test uploads only when storage is enabled.

Monitor CPU time and invocation outcomes in Workers Observability, including agent polling and scheduled runs. The Free plan has a small per-invocation CPU allowance; background work counts too. A successful health check alone does not establish that your workload fits the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Updates and recovery

For D1, follow [Cloudflare’s Time Travel and backup guide](https://developers.cloudflare.com/d1/reference/time-travel/) for **both** databases before upgrading. For libSQL, use provider backups. Then install the reviewed exact package version with `npm install --save-exact devpush@VERSION` and run `npm run deploy` again. Update framework peers when the new package requires it. Migrations are forward-only: rolling back the Worker does not roll back its databases.

Run `npm run configure` to change resources or the origin; existing resources can be selected. Interrupted provisioning resumes from `wrangler.pending.jsonc`. Changing database bindings does not move data. Remote libSQL requires two distinct existing URLs and provider backups; see [Configuration](/docs/configuration/#databases).

For a local D1 inspection, use Wrangler directly with `--local`; `npm run migrate` applies production migrations. The generated scripts use `wrangler.jsonc` and `.cloudflare-secrets.json` in the installation directory.

When moving the same installation to a new origin, preserve databases/keys, update provider callbacks and each agent's `/etc/devpush/agent.env`, then restart agents. Keep the old endpoint until they reconnect. A different installation requires [empty-server switching](/docs/agent-maintenance/#switch-an-empty-server), not a URL edit.
