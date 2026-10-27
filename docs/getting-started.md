---
description: Connect a server and deploy your first application.
---

# Your first deployment

You need a devpush dashboard, a Linux server you administer and a GitHub repository containing a Compose file. [Install devpush](/docs/self-hosting/) if you do not have a dashboard yet.

For a first test, use the [example app](https://github.com/hunvreus/devpush/tree/development/examples/compose-web): service `web`, port `3000`, health path `/health`.

## 1. Connect a server

In your team, open **Servers → Add server**. Run the generated command on the server and wait for **Connected**. Only owners and admins can enroll servers.

Keep the command private: its enrollment credential expires after one hour. The server needs inbound ports 80/443 for public applications. See [Servers](/docs/servers/) for requirements.

## 2. Create a project

Choose **New project**, connect your GitHub account if prompted and grant the GitHub App access to the repository. Select the repository, server and Compose file.

Add required variables and a health check path, then create the project. This saves the configuration without deploying. Production uses the repository's default branch.

devpush suggests a route when the Compose file has an unambiguous HTTP target. Confirm its service and internal port in **Settings → Routes**, or add one if none was suggested. Without a route, the app has no managed public URL. You can also change the health check path later in **Settings → Build & Deploy**.

## 3. Deploy

Open **Deployments → Deploy**, select the environment, branch and commit, then follow its logs. When it succeeds, choose **Visit**.

A push to the environment's branch deploys again automatically. GitHub webhooks require a publicly reachable dashboard; localhost supports manual deployments only.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Missing repository | GitHub App installation and your repository access. |
| Installer cannot download the agent | [Agent release availability](/docs/agent-releases/) and installer output. |
| Disconnected server | Installer output and the agent's access to the dashboard. |
| Failed deployment | Build logs, required variables and Compose health checks. |
| App unreachable | Route service/port, DNS and inbound ports 80/443. |

Next: [environments](/docs/projects/), [custom domains](/docs/domains/) or [backups](/docs/backups/).
