---
description: Run the open-source application as a dependency in your own project.
---

# Package integration (preview)

The `devpush` package contains the application, build integration and migrations. Your project owns its configuration, credentials and any plugins; plugins are optional.

The beta package is available from [GitHub Releases](https://github.com/hunvreus/devpush/releases/tag/v1.0.0-beta.3). For package development, use a locally packed tarball. The guided source-checkout installation is described in [Installation](/docs/self-hosting/).

## Create a project

Use Node.js 22.12+ and pnpm 10.17+. Install the pinned beta tarball:

```sh
pnpm add https://github.com/hunvreus/devpush/releases/download/v1.0.0-beta.3/devpush-1.0.0-beta.3.tgz
```

Install its peer dependencies and Vite, plus Wrangler if you target Workers. Then create `vite.config.mjs`:

```js
import { devpush } from 'devpush/vite'

export default devpush({ target: 'node' })
```

For Workers, point to your own Wrangler configuration:

```js
import { devpush } from 'devpush/vite'

export default devpush({
  target: 'cloudflare',
  wranglerConfig: './wrangler.jsonc',
})
```

Set `DEVPUSH_DEPLOY_TARGET=cloudflare` for Cloudflare builds and the runtime. Use the [configuration reference](/docs/configuration/) to set the public URL, admin email, and authentication and encryption secrets. The config file selects a target; it does not create credentials or databases.

## Node

Configure persistent main and log databases. Node stores uploads in `public/uploads` relative to its working directory; remote image storage is optional. Then apply migrations with the same runtime environment, build and start:

```sh
node --input-type=module -e "import { migrateNode } from 'devpush/migrate'; await migrateNode()"
pnpm exec vite build
node .output/server/index.mjs
```

Set up HTTPS and database backups. The production Node build includes the scheduler. For a container setup, see [Install with Docker Compose](/docs/production-operations/).

## Cloudflare

Start from `node_modules/devpush/wrangler.template.jsonc`. In your own `wrangler.jsonc`:

- Point `main` to `node_modules/devpush/src/server.ts`.
- Point the main and log `migrations_dir` values to `node_modules/devpush/src/server/db/migrations-sqlite` and `node_modules/devpush/src/server/db/migrations-logs`.
- Replace both placeholder D1 IDs with the IDs of your own databases.
- Keep the template's compatibility flags, Durable Object migration and cron.
- Configure your public origin and authentication variables and secrets.

[Install on Cloudflare](/docs/cloudflare-deployment/) describes the bindings. Its setup wizard runs only from a source checkout. After you review the target account and both database bindings, run:

```sh
pnpm exec wrangler d1 migrations apply devpush --remote --config wrangler.jsonc
pnpm exec wrangler d1 migrations apply devpush-logs --remote --config wrangler.jsonc
DEVPUSH_DEPLOY_TARGET=cloudflare pnpm exec vite build
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

If your databases have different names, use those names. These commands change remote resources. Supply secrets through Wrangler before you open sign-in. R2 is optional; without R2 or S3 storage, image upload controls are hidden.

## Local package development

You can use a `file:` dependency during development. After a change, build the package helpers in the source app, refresh the dependency in the consumer project and restart Vite. The consumer must use package exports, not aliases into the source tree. A production build must not depend on a local override.

Register plugins with `devpush({ plugins })`. For the plugin API, see [Development](/docs/development/).

## Upgrades

Pin the exact package version and commit the lockfile. To upgrade:

1. Review the release notes.
2. Back up the databases.
3. Apply new migrations.
4. Rebuild.

Upgrade composed plugins together with the app. Agents are installed from the app's pinned [agent release](/docs/agent-releases/).
