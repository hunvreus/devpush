---
description: Servers endpoints, input fields and response shapes.
---

# Servers API

See the [API guide](/docs/api/) for authentication and retries, or the [endpoint index](/docs/api-operations/) for other resources. All paths below are relative to your dashboard host.

## List servers

`GET /api/v1/servers`

List team server metadata. Unavailable to project-restricted credentials.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

**MCP:** [`list_servers`](/docs/mcp-tools/#list_servers).

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].settingsVersion` | `integer` | Yes | Min 1. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].teamId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].name` | `string` | Yes | — |
| `items[].status` | `string` | Yes | `"pending"`, `"connected"`, `"disconnected"`, `"disabled"`, `"deleted"`. |
| `items[].publicAddress` | `string or null` | Yes | — |
| `items[].agentVersion` | `string or null` | Yes | — |
| `items[].lastSeenAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Get server

`GET /api/v1/servers/{serverId}`

Read server metadata. Enrollment and agent credentials are excluded.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

**MCP:** [`get_server`](/docs/mcp-tools/#get_server).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `teamId` | `string` | Yes | Min 1; max 128 characters. |
| `name` | `string` | Yes | — |
| `status` | `string` | Yes | `"pending"`, `"connected"`, `"disconnected"`, `"disabled"`, `"deleted"`. |
| `publicAddress` | `string or null` | Yes | — |
| `agentVersion` | `string or null` | Yes | — |
| `lastSeenAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |

## Read server metrics

`GET /api/v1/servers/{serverId}/metrics`

Read bounded host metric samples.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

**MCP:** [`read_server_metrics`](/docs/mcp-tools/#read_server_metrics).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |
| `since` | `string` | No | UTC ISO 8601 timestamp. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].observedAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `items[].cpuPercent` | `number or null` | Yes | — |
| `items[].memoryUsedBytes` | `number or null` | Yes | — |
| `items[].memoryTotalBytes` | `number or null` | Yes | — |
| `items[].diskUsedBytes` | `number or null` | Yes | — |
| `items[].diskTotalBytes` | `number or null` | Yes | — |
| `items[].networkReceiveBytesPerSecond` | `number or null` | Yes | — |
| `items[].networkTransmitBytesPerSecond` | `number or null` | Yes | — |
| `nextCursor` | `string or null` | Yes | — |

## Rename server

`PATCH /api/v1/servers/{serverId}`

Rename a server. Requires current team administrator role.

**Permission:** `servers:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `name` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$`. Min 2; max 100 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `teamId` | `string` | Yes | Min 1; max 128 characters. |
| `name` | `string` | Yes | — |
| `status` | `string` | Yes | `"pending"`, `"connected"`, `"disconnected"`, `"disabled"`, `"deleted"`. |
| `publicAddress` | `string or null` | Yes | — |
| `agentVersion` | `string or null` | Yes | — |
| `lastSeenAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |

## Create server

`POST /api/v1/servers`

Create a pending server. Enrollment credentials are generated separately in the browser.

**Permission:** `servers:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$`. Min 2; max 100 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 201.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `teamId` | `string` | Yes | Min 1; max 128 characters. |
| `name` | `string` | Yes | — |
| `status` | `string` | Yes | `"pending"`, `"connected"`, `"disconnected"`, `"disabled"`, `"deleted"`. |
| `publicAddress` | `string or null` | Yes | — |
| `agentVersion` | `string or null` | Yes | — |
| `lastSeenAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |

## Enable server

`POST /api/v1/servers/{serverId}/enable`

Enable a disabled server. Requires current administrator role.

**Permission:** `servers:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

None.

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |
| `enabled` | `boolean` | Yes | Exactly `true`. |

## Disable server

`POST /api/v1/servers/{serverId}/disable`

Disable a server using its name as confirmation. Requires current administrator role.

**Permission:** `servers:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `confirmationName` | `string` | Yes | Min 1; max 100 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |
| `enabled` | `boolean` | Yes | Exactly `false`. |

## Delete server

`DELETE /api/v1/servers/{serverId}`

Delete a server using its name as confirmation. Existing deployment cancellation is an explicit option.

**Permission:** `servers:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `confirmationName` | `string` | Yes | Min 1; max 100 characters. |
| `cancelOngoingDeployments` | `boolean` | No | Default: `true`. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |
| `status` | `string` | Yes | Exactly `"deleted"`. |

## Get server delete diagnostic

`GET /api/v1/servers/{serverId}/delete-diagnostic`

Read counts of active project and environment assignments affected by server deletion.

**Permission:** `servers:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | Min 1; max 128 characters. |
| `projectCount` | `integer` | Yes | Min 0. |
| `environmentCount` | `integer` | Yes | Min 0. |
