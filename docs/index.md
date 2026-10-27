---
description: Deploy apps from GitHub to your own servers with Docker Compose.
---

# Introduction

devpush deploys applications from GitHub to your own Linux servers. Connect a
server, choose a repository with a Docker Compose file, and deploy. Later pushes
to a configured branch trigger new deployments.

Use the dashboard to follow build logs, manage domains and environment variables,
monitor servers, and back up application data. Configure [email notifications](/docs/notifications/) for operational failures and recovery.

## Deploy your first app

Already have access to a devpush dashboard? Start with
[Getting started](/docs/getting-started/). You do not need to install the dashboard
or run devpush from source to use an existing installation.

Want to run the dashboard yourself? Follow [Self-host devpush](/docs/self-hosting/)
first, or use [Package installation](/docs/package-installation/) to compose your
own configured application. To work on the code locally, use [Local development](/docs/local-setup/).

## How the pieces fit together

- **Dashboard:** where you manage projects, servers and deployments. The dashboard
  and its backend are called the *control plane* in the operator guides.
- **Server:** a Linux machine you provide. Its devpush agent receives jobs and runs
  your application containers using Docker Compose.
- **Project:** a GitHub repository and its deployment settings.
- **Environment:** a branch rule, variables and server assignment, such as Production.
- **Deployment:** an attempt to run one commit in an environment.

The dashboard can run on a different machine from your applications. Hosting the
dashboard on Cloudflare Workers does not run your applications on Cloudflare.

## Common tasks

| I want to… | Read |
| --- | --- |
| Set branches, variables or deployment servers | [Projects and environments](/docs/projects/) |
| Connect a server or check its connection | [Servers](/docs/servers/) |
| Configure a Compose app or investigate a failed deploy | [Compose deployments](/docs/compose-deployments/) |
| Use my own domain and HTTPS | [Domains and HTTPS](/docs/domains/) |
| Back up or restore application data | [Backups](/docs/backups/) |
| Invite teammates and manage permissions | [Accounts and teams](/docs/accounts-and-teams/) |
| Automate deployments or connect an AI assistant | [API keys and AI assistants](/docs/api-and-mcp/) |

## What is supported

Applications use Docker Compose. A service can build from a Dockerfile, but a
Dockerfile alone is not a devpush project. Docker Swarm is not supported.
Deployments update an environment in place; zero downtime is not guaranteed.
Rollback changes application code and settings, not database or volume contents.

For trust boundaries, supported security checks and credential handling, see
[Security](/docs/security/).
