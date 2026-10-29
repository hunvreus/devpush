---
description: Choose where to run the dashboard and prepare installation.
---

# Installation

Install the dashboard first, then [connect servers and deploy apps](/docs/getting-started/). Application containers run on Linux servers regardless of where the dashboard runs.

Choose your dashboard target:

- [Cloudflare Workers](/docs/cloudflare-deployment/): Worker and two D1 databases, with optional R2 for image uploads.
- [Docker Compose](/docs/production-operations/): Node app, persistent databases and uploads. You provide its HTTPS reverse proxy.

Both also support remote libSQL/Turso databases. Neither option provisions your application servers.

## Prepare

You need Node.js 22.12+, pnpm 10.17+, a stable dashboard URL and at least one sign-in method: Resend email codes, Google or GitHub. Repository access and push events require a GitHub App. The setup wizard helps configure these.

Start with a source checkout:

```sh
git clone --branch v1.0.0-beta.9 https://github.com/hunvreus/devpush.git
cd devpush
```

Then follow your chosen target guide. To use devpush as a dependency in your own project, see [Package integration](/docs/package-installation/).

## Before opening access

Set `DEVPUSH_ADMIN_EMAIL`, configure the [allowlist](/docs/accounts-and-teams/#installation-administration) and check `/api/health`. An empty allowlist permits everyone. Keep database backups and installation secrets outside the host.

Deploy only trusted repositories. Docker workloads can access their host; use separate servers for mutually untrusted code. Do not commit generated configuration, credentials, database files or agent enrollment commands.
