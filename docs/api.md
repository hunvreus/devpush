---
description: Authenticate REST requests, deploy an application and handle results and errors.
---

# API guide

Use the REST API to automate devpush from scripts and integrations. The hosted base URL is **`https://app.devpu.sh/api/v1`**; self-hosted installations use their dashboard host followed by `/api/v1`.

For every endpoint and its fields, see the [API reference](/docs/api-operations/). To connect an AI assistant, use the [MCP guide](/docs/mcp/).

## Create a key

Open **Account → API keys → Create API key**. Select a team, optional projects, access level, log permission and expiry. Copy the key once into your integration's secret manager.

| Access | Allows |
| --- | --- |
| Read only | Inspect projects, servers, deployments and backups. |
| Deploy | Read resources and deploy, redeploy or roll back. |
| Manage | Configure resources and run or restore backups, subject to your team role. |

Log access is separate because output may contain secrets. Server and backup-storage operations require workspace-wide access. Backup changes and restores require an owner/admin role. Saved variable values and agent credentials are never returned.

**Revoke** stops access; **Rotate** immediately invalidates the previous key. Keys never exceed their issued permissions or your current membership. Removing a membership invalidates its credentials; rejoining does not revive them.

## Make a request

REST accepts bearer API keys, not browser cookies or MCP OAuth tokens. Set these values in your shell without committing the key:

```sh
export DEVPUSH_URL="https://app.devpu.sh"
export DEVPUSH_API_KEY="YOUR_API_KEY"

curl "$DEVPUSH_URL/api/v1/projects?limit=25" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY"
```

Lists return `items` and `nextCursor`. Pass the cursor as the next request's `cursor` query parameter until it is `null`, including after an empty filtered page. Pages default to 25 items, maximum 100. IDs are opaque: use values returned by the API.

## Deploy and follow progress

Use a Deploy or Manage key. Obtain a project ID from [List projects](/docs/api-projects/#list-projects) and an environment ID from [List environments](/docs/api-projects/#list-environments). The branch must match that environment's branch rule.

```sh
curl "$DEVPUSH_URL/api/v1/projects/PROJECT_ID/deployments" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data '{"environmentId":"ENVIRONMENT_ID","branch":"main"}'
```

Example HTTP 202 response:

```json
{
  "deploymentId": "deployment_123",
  "statusUrl": "/api/v1/deployments/deployment_123"
}
```

Acceptance queues work; it does not mean the deployment succeeded. Poll the returned `statusUrl` on the same dashboard host:

```sh
curl "$DEVPUSH_URL/api/v1/deployments/deployment_123" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY"
```

`queued` and `running` are in progress. `succeeded`, `failed` and `canceled` are terminal. Backup and restore operations follow the same pattern with backup/job IDs; see [Backups and jobs](/docs/api-backups/).

## Writes and retries

Send JSON for writes. Every write requires an **`Idempotency-Key` header**. Reuse the same key and identical payload when retrying one action; generate a new key for a new action. Different input with the same key returns `IDEMPOTENCY_CONFLICT`. Replay records last at least 24 hours.

Configuration writes require the latest `settingsVersion` from a read of that resource. On HTTP 409 `SETTINGS_CONFLICT`, reload and review current settings before resubmitting. Destructive operations require the confirmation fields listed in the reference. Request bodies are limited to 128 KiB; unknown fields are rejected.

## Errors and limits

Failures return this shape; keep `requestId` when reporting an issue:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The resource was not found.",
    "requestId": "request_123"
  }
}
```

| Status | What to do |
| --- | --- |
| 400 / 422 | Correct invalid input; validation errors may include `fieldErrors`. |
| 401 | Check whether the key is missing, expired or revoked. |
| 403 | Check the key's scope, project restrictions and current team role. |
| 404 | Check the resource ID and your access. |
| 409 | Resolve a settings, idempotency or resource-state conflict before retrying. |
| 429 | Wait for `Retry-After` before retrying. |
| 500 | Keep the request ID. Before retrying a write, inspect its outcome and reuse its idempotency key. |

Resource budgets allow 120 reads/minute per membership and 20 writes/minute per membership and operation. Transport limits also apply. Logs have bounded pages and retention; do not use the API as an archival log drain.

The [OpenAPI JSON](https://app.devpu.sh/api/v1/openapi.json) provides the machine-readable request/response schemas. Self-hosted installations expose it at the same path on their dashboard host.
