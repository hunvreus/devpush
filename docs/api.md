---
description: Create API keys, connect assistants and automate deployments.
---

# API and AI assistants

Use the REST API at `/api/v1` or connect an assistant to `/mcp`. Both enforce your current team permissions. Saved variable values and agent credentials are never returned; log access is separate because output may contain secrets.

## Create an API key

Open **Account → API keys → Create API key**. Select the team, optional project, Read only/Deploy/Manage access, log permission and expiry. The default lifetime is 30 days.

Copy the value once into your integration's secret manager. **Revoke** stops access; **Rotate** immediately invalidates the previous key. Removing a membership invalidates its credentials; rejoining does not revive them.

```sh
curl "$DEVPUSH_URL/api/v1/projects?limit=25" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY"
```

REST accepts API keys, not browser cookies or MCP OAuth tokens. The [operation reference](/docs/api-operations/) lists scopes and supported actions. Your installation's `/api/v1/openapi.json` supplies the actual request/response schemas.

## Connect an assistant

Use **`https://app.devpu.sh/mcp`** for the hosted app. For a self-hosted installation, use `https://YOUR-DEVPUSH-HOST/mcp`. Copy the exact URL from **Account → Connected apps** and add it to a client supporting remote HTTP MCP. The marketing site at `devpu.sh` is not the MCP endpoint.

For Claude Code:

```sh
claude mcp add --transport http devpush https://app.devpu.sh/mcp
```

Replace the URL for self-hosting. Open Claude Code, run `/mcp`, select devpush and authenticate in the browser. Then open a fresh Claude Code session. Start with a read, such as “List my devpush servers and their current resource usage.”

- **Browser sign-in:** approve the team, optional project and permissions. Manage/revoke the resulting 30-day grant in Connected apps.
- **API key:** supply `Authorization: Bearer KEY` if the client supports custom headers. Manage it under API keys; it does not create a Connected apps entry.

Check the callback host on consent screens. Cloud-hosted assistants cannot reach localhost. Node and Workers support dynamic client registration; metadata-discovery-only clients work on Node, not Workers. Changing `DEVPUSH_MCP_URL` requires OAuth clients to reconnect.

## Available tools

Tools are shown only when your grant and current team role permit them.

| Area | Actions |
| --- | --- |
| Servers | List servers, inspect connection and agent metadata, read resource metrics. |
| Deployments | Deploy, redeploy, roll back, inspect status and read permitted logs. |
| Backups | Manage policies, run backups, inspect runs/artifacts and restore with explicit confirmation. |
| Projects | Create, rename or delete projects; manage runtime configuration, routes, environments and server assignments. |
| Variables and domains | List variable names and write values without reading secrets; inspect domains and generated aliases. |

MCP does not provide arbitrary SSH/shell access, cloud-server provisioning, server enrollment or custom-domain creation. These remain separate workflows. Backup/restore requires an enrolled server and configured policy; accepting a tool call queues work, so check the returned job status. See the [operation reference](/docs/api-operations/) for the complete list.

## Requests and pagination

Send JSON for writes. Lists return `items` and `nextCursor`; follow cursors until null, including after empty filtered pages. Pages default to 25 items, maximum 100. Request bodies are limited to 128 KiB; unknown fields are rejected.

Keys and OAuth grants never exceed their issued scopes/role or current membership. Project-restricted credentials cannot manage whole-team resources. See [operations](/docs/api-operations/) for additional owner/admin requirements.

## Writes and retries

Every REST write needs a unique `Idempotency-Key`; MCP uses `idempotencyKey`. Reuse the same key and identical payload when retrying the same action. Different input returns `IDEMPOTENCY_CONFLICT`. Replay records last at least 24 hours, not indefinitely.

```sh
curl "$DEVPUSH_URL/api/v1/projects/PROJECT_ID/deployments" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data '{"environmentId":"ENVIRONMENT_ID","branch":"main"}'
```

Acceptance is not execution success: retain the returned deployment/job ID and poll its status. When an outcome is uncertain, inspect history before creating a new action.

Configuration writes require the latest `settingsVersion`. HTTP 409 `SETTINGS_CONFLICT` means read current settings and review changes before resubmitting. Destructive actions require the confirmations in their schemas.

## Errors and limits

Errors contain `error.code`, `message` and `requestId`. Keep the request ID when reporting failures. Honor `Retry-After` on HTTP 429. Resource budgets allow 120 reads/minute per membership and 20 writes/minute per membership and operation. Transport limits also apply.

Logs have bounded pages and may be truncated or removed by retention. Do not treat the API as an archival log drain.
