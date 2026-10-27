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

Copy the URL from **Account → Connected apps**, usually `https://YOUR-DEVPUSH-HOST/mcp`. Add it to a client supporting remote HTTP MCP.

- **Browser sign-in:** approve the team, optional project and permissions. Manage/revoke the resulting 30-day grant in Connected apps.
- **API key:** supply `Authorization: Bearer KEY` if the client supports custom headers. Manage it under API keys; it does not create a Connected apps entry.

Check the callback host on consent screens. Cloud-hosted assistants cannot reach localhost. Node and Workers support dynamic client registration; metadata-discovery-only clients work on Node, not Workers. Changing `DEVPUSH_MCP_URL` requires OAuth clients to reconnect.

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
