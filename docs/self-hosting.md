---
description: Install devpush with one command.
---

# Installation

Run the dashboard on Docker Compose or Cloudflare Workers. Your apps run on your Linux servers.

## Install

You need **Node.js 22.12+ and npm**, plus Docker Compose or a Cloudflare account.

```sh
npx devpush@latest init
```

The wizard creates a `devpush` folder, installs the package and walks you through setup:

1. Choose Docker Compose or Cloudflare Workers.
2. Set your dashboard URL and administrator email.
3. Configure sign-in and your GitHub App.
4. Review and approve deployment.

**Docker needs an HTTPS reverse proxy.** Cloudflare can use a `workers.dev` URL or your own domain.

See [Docker setup](/docs/production-operations/) or [Cloudflare setup](/docs/cloudflare-deployment/) for requirements and details.

## Next

Open your dashboard, sign in and [deploy your first app](/docs/getting-started/).

To resume setup:

```sh
cd devpush
npm run configure
```

To deploy later, run `npm run deploy`.

## Before opening access

Keep installation secrets and database backups safe. Restrict access with the [allowlist](/docs/accounts-and-teams/#installation-administration). Deploy only trusted code; Docker access can expose the host.

For an existing project, see [Package integration](/docs/package-installation/).
