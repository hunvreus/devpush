---
description: Choose where to run the devpush dashboard and prepare a new installation.
---

# Self-host devpush

Self-hosting runs your own devpush dashboard and backend. Your applications run
on Linux servers connected to it by the agent. These are separate setup tasks:
install the dashboard first, then connect a deployment server.

## Choose an installation

| Option | What you operate | Guide |
| --- | --- | --- |
| Docker Compose | A Node container, databases, uploaded files and a scheduler on your host. You provide HTTPS. | [Install with Docker Compose](/docs/production-operations/) |
| Cloudflare Workers | A Worker, D1 or remote databases, R2 object storage and scheduled maintenance in your Cloudflare account. | [Install on Cloudflare](/docs/cloudflare-deployment/) |
| Local development | A source checkout on your laptop, optionally with a Lima deployment VM. | [Local development](/docs/local-setup/) |

Both production options provide the same Compose deployment model. Choosing
Workers does not provision application servers or turn Compose services into Workers.

## Prepare before installation

- A checkout of the devpush repository and Node.js 22+ with pnpm 10.17+.
- A stable HTTPS URL for the dashboard. Configure it before enrolling servers.
- A GitHub App for repository access and push events. User sign-in and repository
  installation access are separate permissions.
- At least one sign-in method: email codes through Resend, Google or GitHub.
- An installation-admin email address, set with `DEVPUSH_ADMIN_EMAIL`.

Docker installation also needs Docker with Compose; its image build includes the
Go agent build. Cloudflare deployment needs Wrangler authentication and Go 1.27+
to build the published agent binaries. Each target guide explains its storage setup.

The [configuration reference](/docs/configuration/#authentication) lists provider
callbacks and GitHub App permissions. Use separate provider apps for development
and production. Preserve existing production app identities during a migration.

## After installation

1. Check the dashboard's `/api/health` endpoint, then sign in.
2. Restrict access with the [signup allowlist](/docs/administration/#signup-allowlist)
   before opening a private installation to others. An empty allowlist allows everyone.
3. Keep the database, uploaded files and encryption secrets backed up. See
   [Control-plane backups](/docs/production-operations/#control-plane-backups).
4. Follow [Getting started](/docs/getting-started/) to connect a server and deploy.

Application backups protect deployed app data. They do not replace backups of
this devpush installation.
