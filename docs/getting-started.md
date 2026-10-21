---
description: Connect a server and deploy your first Docker Compose application from GitHub.
---

# Getting started

This guide takes you from a devpush dashboard to a running application.
If you do not have a dashboard yet, [self-host devpush](/docs/self-hosting/) first.

## Before you start

You need:

- Access to a devpush installation. A default team is created for a new account;
  select that team or one you have joined.
- A Linux server you can administer. See [server requirements](/docs/servers/#server-requirements).
- A GitHub repository containing a Compose file, with access granted to the
  installation's GitHub App.

For a first test, the repository's
[Compose example](https://github.com/hunvreus/devpush/tree/main/examples/compose-web)
contains a small web service. Put the example files at the root of a repository
accessible to your GitHub App. It uses service `web`, internal port `3000` and
health check path `/health`.

People who can push deployed code must be trusted with the target server.
Use separate servers for repositories you do not trust together.

## 1. Connect your server

1. Sign in and select your team.
2. Open **Servers** and add a server. You must be a team owner or admin.
3. Copy the generated install command and run it on the Linux server.
4. Wait for the server to show **Connected** in the dashboard.

The installer sets up the agent and its dependencies. The agent connects outward
to the dashboard; you do not give devpush an SSH key. The command contains a
one-hour enrollment credential: keep it private and generate another if it expires.

For a local test on macOS, use the [Lima VM workflow](/docs/local-setup/#deploy-to-a-local-vm).

## 2. Create a project

1. Choose **New project**. If prompted, choose **Connect GitHub** or **Add GitHub
   account** to link your account, then **Install GitHub App** to grant repository
   access. These are separate steps, even if you signed in using email or Google.
2. Select your repository. If it is missing, check the GitHub App installation
   and your own repository access.
3. Review the project name, server and Compose file path.
4. Add any environment variables required by the app, then create the project.
5. In **Settings → Routes**, check the HTTP service and internal port. For the
   example above, use path `/`, service `web` and port `3000`.
6. In **Settings → Build & Deploy**, set **Health check path** to `/health` for
   that example, or to your application's readiness endpoint.

A **Production** environment is created for the repository's default branch.
Creating the project saves its settings; it does not start a deployment.
A suggested route may be provided from the Compose file. If none is suggested,
add one explicitly. Without routes, the app has no devpush-managed public URL.

## 3. Deploy and open the app

1. Open **Deployments** and choose **Deploy**.
2. Select the environment, branch and commit, then submit.
3. Open the deployment to follow its logs.
4. When it succeeds, choose **Visit**.

For a public server, the generated URL normally uses HTTPS. A private local
server uses HTTP. Certificate issuance can take a little time on the first deploy.
Your server must accept application traffic on ports 80 and 443 for public HTTPS.

Push another commit to the environment's branch to deploy again automatically.
This requires the GitHub webhook to reach the dashboard at a public URL.
A localhost-only dashboard supports manual deployments, but cannot receive those
push events directly.

## If something goes wrong

| Problem | Check |
| --- | --- |
| Server does not connect | The installer output and the server's outbound access to the dashboard. See [Servers](/docs/servers/). |
| Repository is missing | The GitHub App installation and your repository access. |
| Build or startup fails | Deployment logs, required variables and the Compose file at that commit. |
| Visit fails | The route's service/port, the server's firewall and DNS. See [Domains and HTTPS](/docs/domains/#troubleshooting). |
| Push does not deploy | The environment's branch rule, GitHub webhook delivery and assigned server connection. |

Next, [add your domain](/docs/domains/), [configure environments](/docs/projects/)
or [set up backups](/docs/backups/).
