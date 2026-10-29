---
description: Connect an assistant to devpush and use it to inspect servers, deploy applications and manage backups.
---

# MCP guide

Connect an assistant to **`https://app.devpu.sh/mcp`** to manage devpush through conversation. For self-hosting, use `https://YOUR-DEVPUSH-HOST/mcp`. Copy the exact URL from **Account → Connected apps**. The marketing site at `devpu.sh` is not the MCP endpoint.

See the [MCP tools](/docs/mcp-tools/) for every tool's name, arguments, permissions and result.

## Connect your client

Add a remote HTTP MCP server using the URL above. The client opens a browser sign-in flow; approve the team, optional project restrictions and permissions. The resulting grant lasts 30 days and can be revoked under **Account → Connected apps**.

For Claude Code:

```sh
claude mcp add --transport http devpush https://app.devpu.sh/mcp
```

Open Claude Code, run `/mcp`, select devpush and authenticate in the browser. Open a fresh session after connecting. Replace the URL for self-hosting.

Clients that support custom headers can instead use an [API key](/docs/api/#create-a-key) with `Authorization: Bearer KEY`. API-key connections are managed under **Account → API keys**; they do not create a Connected apps entry.

Check the callback host shown during consent. Cloud-hosted assistants cannot reach a localhost dashboard. Node and Workers support dynamic client registration; clients using only client-metadata URL discovery work on Node, not Workers. Changing `DEVPUSH_MCP_URL` requires clients to reconnect.

## Choose access

| Access | Use it for |
| --- | --- |
| Read only | Checking server health, inspecting projects and following deployment or backup status. |
| Deploy | Deploying, redeploying and rolling back applications. |
| Manage | Changing configuration and running or restoring backups. |

Permissions also follow your current team role. Backup changes and restores require an owner/admin role. Choose workspace-wide access to inspect servers; a project-restricted grant hides team-wide tools. Reading logs requires separate log permission. Variable values and agent credentials are never returned.

## Try it

Start with reads:

> List my devpush servers and show their latest CPU, memory and disk usage.

The assistant uses `list_servers`, then `read_server_metrics`. If no servers appear, check your selected team and whether the connection is project-restricted.

> Show the latest deployments for my web-app project. If the latest failed, read its deployment logs.

This uses `list_projects`, `list_deployments` and `read_deployment_logs`. The last call needs log permission.

With Deploy or Manage access:

> Deploy the main branch of web-app to Production, then check its status until it finishes.

The assistant resolves the project/environment IDs, calls `deploy` and follows `get_deployment`. A successful tool call queues the deployment; its terminal status determines whether it worked.

With Manage access and an owner/admin role:

> Run the Production backup policy for web-app, then check that the backup completed successfully.

This uses `list_backup_policies`, `run_backup` and `get_backup`. A `run_backup` argument object looks like:

```json
{
  "projectId": "PROJECT_ID",
  "environmentId": "ENVIRONMENT_ID",
  "policyId": "POLICY_ID",
  "idempotencyKey": "UNIQUE_REQUEST_ID"
}
```

Use IDs returned by earlier reads. Reuse the same idempotency key when retrying one action. For restores, inspect `list_backup_artifacts`, confirm the target, call `restore_backup` with its explicit confirmation argument, then follow `get_job`. A restore replaces data; review it before approving.

## Boundaries

MCP exposes the tools available to your grant, not arbitrary SSH/shell access or cloud-server provisioning. Server enrollment, custom-domain creation, account settings and membership changes remain browser workflows. See the [tool reference](/docs/mcp-tools/) for supported actions.

Tool failures set `isError` and return a JSON error with a code, message and request ID. Correct permissions or input before retrying; follow the [API retry rules](/docs/api/#writes-and-retries) for writes. Revoke the connection under Connected apps when it is no longer needed.
