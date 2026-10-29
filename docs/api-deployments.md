---
description: Deployments and logs endpoints, input fields and response shapes.
---

# Deployments and logs API

See the [API guide](/docs/api/) for authentication and retries, or the [endpoint index](/docs/api-operations/) for other resources. All paths below are relative to your dashboard host.

## List deployments

`GET /api/v1/projects/{projectId}/deployments`

List deployment metadata. Build snapshots and variable values are excluded.

**Permission:** `deployments:read` · Team member.

**MCP:** [`list_deployments`](/docs/mcp-tools/#list_deployments).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |
| `environmentId` | `string` | No | Min 1; max 128 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].projectId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].serverId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].status` | `string` | Yes | `"queued"`, `"running"`, `"succeeded"`, `"failed"`, `"canceled"`. |
| `items[].phase` | `string or null` | Yes | — |
| `items[].trigger` | `string` | Yes | `"user"`, `"webhook"`, `"api"`, `"rollback"`. |
| `items[].repository` | `string` | Yes | — |
| `items[].sha` | `string` | Yes | — |
| `items[].branch` | `string` | Yes | — |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `items[].startedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `items[].finishedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Get deployment

`GET /api/v1/deployments/{deploymentId}`

Read deployment status by immutable deployment ID.

**Permission:** `deployments:read` · Team member.

**MCP:** [`get_deployment`](/docs/mcp-tools/#get_deployment).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |
| `status` | `string` | Yes | `"queued"`, `"running"`, `"succeeded"`, `"failed"`, `"canceled"`. |
| `phase` | `string or null` | Yes | — |
| `trigger` | `string` | Yes | `"user"`, `"webhook"`, `"api"`, `"rollback"`. |
| `repository` | `string` | Yes | — |
| `sha` | `string` | Yes | — |
| `branch` | `string` | Yes | — |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `startedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `finishedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |

## Read deployment logs

`GET /api/v1/deployments/{deploymentId}/logs`

Read bounded build or control log entries. Application output may contain secrets.

**Permission:** `logs:read` · Team member.

**MCP:** [`read_deployment_logs`](/docs/mcp-tools/#read_deployment_logs).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |
| `stream` | `string` | No | Default: `"build"`. Exactly `"build"`. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].position` | `integer` | Yes | Min 0. |
| `items[].content` | `string` | Yes | max 65536 characters. |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `items[].truncated` | `boolean` | Yes | — |
| `nextCursor` | `string or null` | Yes | — |
| `retentionMayHaveRemovedEarlierEntries` | `boolean` | Yes | Exactly `true`. |

## Read runtime logs

`GET /api/v1/projects/{projectId}/runtime-logs`

Read bounded runtime output from current environment server assignments. Application output may contain secrets.

**Permission:** `logs:read` · Team member.

**MCP:** [`read_runtime_logs`](/docs/mcp-tools/#read_runtime_logs).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |
| `environmentId` | `string` | No | Min 1; max 128 characters. |
| `service` | `string` | No | Min 1; max 128 characters. |
| `keyword` | `string` | No | Min 1; max 200 characters. |
| `since` | `string` | No | UTC ISO 8601 timestamp. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].service` | `string` | Yes | — |
| `items[].content` | `string` | Yes | max 65536 characters. |
| `items[].observedAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `items[].truncated` | `boolean` | Yes | — |
| `nextCursor` | `string or null` | Yes | — |
| `retentionMayHaveRemovedEarlierEntries` | `boolean` | Yes | Exactly `true`. |

## Deploy

`POST /api/v1/projects/{projectId}/deployments`

Queue a deployment from a matching GitHub branch. Requires a unique idempotencyKey; returns acceptance, not execution success.

**Permission:** `deployments:write` · Team member.

**MCP:** [`deploy`](/docs/mcp-tools/#deploy).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `branch` | `string` | Yes | Min 1; max 255 characters. |
| `sha` | `string` | No | Pattern: `^[a-f0-9]{40}$`. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 202.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |
| `statusUrl` | `string` | Yes | — |

## Redeploy

`POST /api/v1/deployments/{deploymentId}/redeploy`

Queue the recorded commit and runtime settings with current routing.

**Permission:** `deployments:write` · Team member.

**MCP:** [`redeploy`](/docs/mcp-tools/#redeploy).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

None.

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 202.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |
| `statusUrl` | `string` | Yes | — |

## Rollback

`POST /api/v1/deployments/{deploymentId}/rollback`

Queue a successful recorded commit and runtime settings with current routing.

**Permission:** `deployments:write` · Team member.

**MCP:** [`rollback`](/docs/mcp-tools/#rollback).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `confirmation` | `string` | Yes | Exactly `"rollback"`. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 202.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | Min 1; max 128 characters. |
| `statusUrl` | `string` | Yes | — |

## Get deployment options

`GET /api/v1/projects/{projectId}/deploy-options`

List one provider page of matching branches and recent commits only for the selected branch. Continue with nextCursor to reach later matching branches, including after empty filtered pages.

**Permission:** `deployments:read` · Team member.

**MCP:** [`get_deployment_options`](/docs/mcp-tools/#get_deployment_options).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |
| `environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `branch` | `string` | No | Min 1; max 255 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `branches` | `string[]` | Yes | max 100 items. |
| `nextCursor` | `string or null` | Yes | — |
| `selectedBranch` | `string or null` | Yes | — |
| `commits` | `object[]` | Yes | max 5 items. |
| `commits[].sha` | `string` | Yes | — |
| `commits[].message` | `string or null` | Yes | — |
| `commits[].url` | `string or null` | Yes | — |
| `commits[].authorName` | `string or null` | Yes | — |
| `commits[].authoredAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
