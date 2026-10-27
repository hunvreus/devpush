---
description: Run the open-source application as a dependency in your own project.
---

# Package installation

The `devpush` package contains the application, build integration and migrations.
Your project owns its configuration, credentials and optional plugins. The default
installation requires no plugins.

## Create a project

Use Node.js 22.12+ and pnpm 10.17+. Install an exact published `devpush` version
and its declared peer dependencies, plus Vite and Wrangler for your build target.
The first release is not published yet;
until then, use a locally packed tarball or the source-checkout guides. Do not
assume a proposed release number already exists on npm.

Create `vite.config.mjs`:

```js
import { devpush } from 'devpush/vite'

export default devpush({ target: 'node' })
```

For Workers, select your own Wrangler configuration:

```js
import { devpush } from 'devpush/vite'

export default devpush({
  target: 'cloudflare',
  wranglerConfig: './wrangler.jsonc',
})
```

Set `DEVPUSH_DEPLOY_TARGET=cloudflare` for the Cloudflare build/runtime. Configure
the final public URL, admin email, authentication and encryption secrets using the
[configuration reference](/docs/configuration/). A config file selects the target;
it does not create provider credentials or provision databases.

## Node

Configure persistent main/log databases and image storage. Before starting the
built application, apply migrations with the same runtime environment:

```sh
node --input-type=module -e "import { migrateNode } from 'devpush/migrate'; await migrateNode()"
pnpm exec vite build
node .output/server/index.mjs
```

Arrange HTTPS and database backups. The source repository's
[Docker Compose installation](/docs/production-operations/) supplies the container
setup; production Node builds include scheduling, while Cloudflare requires its Cron Trigger configuration.

## Cloudflare

Provision separate main/log D1 databases, configure bindings and secrets, apply
migrations and deploy the build. Follow [Cloudflare deployment](/docs/cloudflare-deployment/)
for the binding names, migration paths and commands. That guide's setup wizard
runs from the source checkout; it is not a CLI included in the package.
For a custom package consumer, start from the package's
`node_modules/devpush/wrangler.template.jsonc`. In your own `wrangler.jsonc`:

- Point `main` to `node_modules/devpush/src/server.ts`.
- Point the main/log `migrations_dir` values to
  `node_modules/devpush/src/server/db/migrations-sqlite` and
  `node_modules/devpush/src/server/db/migrations-logs` respectively.
- Replace both placeholder D1 IDs with your provisioned database IDs.
- Preserve the template's compatibility flags, Durable Object migration and cron.
- Configure your public origin and authentication variables/secrets.

After reviewing the target account and both database bindings:

```sh
pnpm exec wrangler d1 migrations apply devpush --remote --config wrangler.jsonc
pnpm exec wrangler d1 migrations apply devpush-logs --remote --config wrangler.jsonc
DEVPUSH_DEPLOY_TARGET=cloudflare pnpm exec vite build
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

Use your configured database names if different. These commands change remote
resources. Supply application secrets through Wrangler before opening sign-in;
the template alone is not a configured installation.

R2 is optional: without image storage, provider avatars and generated fallbacks
work and image upload controls are hidden. Agent binaries come from GitHub Releases.

## Local package development

A local `file:` dependency is valid for development. Build package helpers in the source app, refresh the installed
dependency in the consumer and restart Vite after changes. The consumer must use
package exports, not aliases into the sibling source tree.

For reproducible release builds, install the exact published package version and
commit the lockfile. A local workspace override can be used during development;
it must not become a prerequisite of the production build.

Plugin API v3 policies implement `workspaceAccess.run`. There is no policy callback on agent connection; use server lifecycle hooks for connection-related work. Upgrade the app and its composed plugins together.

## Versions and upgrades

Use `1.0.0-beta.1` for the proposed first beta, followed by beta.2 and so on;
`1.0.0` marks the stable release. Before tagging, update the application version
and regenerate the matching agent manifest/binaries/checksums together. Do not
rename the existing manifest URLs without rebuilding release artifacts.

Pin the application dependency, review release notes, back up databases, apply
new migrations and rebuild. Agents are independently installed using the
application's pinned release. See [Agent releases](/docs/agent-releases/).
