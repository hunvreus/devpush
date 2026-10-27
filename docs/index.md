---
description: What devpush is, why it exists and how it works.
---

# Overview

devpush is an open-source deployment platform for applications running on your own servers. Connect a GitHub repository, configure its Docker Compose services and push to deploy.

## Why devpush?

devpush started with a simple goal: make deploying Python applications as straightforward as deploying with Vercel. That goal extends to any application that runs with Docker Compose.

You choose the infrastructure and keep control of your data. devpush brings deployments, domains, logs, monitoring and backups into one interface, so you spend less time assembling and maintaining deployment scripts.

## How it works

The dashboard runs on Cloudflare Workers or as a Node app; the supplied Node installation uses Docker Compose. An agent on each Linux server connects to it, runs Docker Compose and reports progress and health. Application traffic goes directly to your servers.

Projects connect repositories to environments, such as production and staging. Each environment has its own variables and server assignment. GitHub pushes trigger deployments for matching branches.

Compose is required; Dockerfiles can be used within it. Updates happen in place and do not guarantee zero downtime. Deploy only trusted code: Docker workloads can access their host.

## Get started

[Install devpush](/docs/self-hosting/) to run your own dashboard, or follow [Your first deployment](/docs/getting-started/) if one is already available.
