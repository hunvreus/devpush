---
description: Deploy GitHub applications to your own servers.
---

# devpush

devpush is an open-source deployment platform for apps that run with Docker Compose. Connect a Linux server, select a GitHub repository and deploy. Pushes to configured branches deploy automatically.

The dashboard runs on Cloudflare Workers or Node. A small agent runs your applications on your servers and reports deployment progress, logs and resource usage.

- **New installation:** [Install devpush](/docs/self-hosting/).
- **Dashboard already running:** [Deploy your first app](/docs/getting-started/).
- **Contributing:** [Local development](/docs/local-setup/).

## What you can do

- Deploy Compose apps with separate environments and encrypted variables.
- Connect custom domains with automatic HTTPS.
- Inspect build logs, runtime logs and server health.
- Schedule database and volume backups.
- Work with a team or connect integrations through the API and MCP.

Compose is required; a Dockerfile can be used inside it. Updates happen in place and do not guarantee zero downtime. Deploy only trusted repositories: Docker access gives deployed code control over its server.
