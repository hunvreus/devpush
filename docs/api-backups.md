---
description: Backups and jobs endpoints, input fields and response shapes.
---

# Backups and jobs API

See the [API guide](/docs/api/) for authentication and retries, or the [endpoint index](/docs/api-operations/) for other resources. All paths below are relative to your dashboard host.

## Get backup policy

`GET /api/v1/projects/{projectId}/backup-policies/{policyId}`

Read a backup policy without commands or storage credentials.

**Permission:** `backups:read` · Team member.

**MCP:** [`get_backup_policy`](/docs/mcp-tools/#get_backup_policy).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `policyId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `name` | `string` | Yes | Min 1; max 100 characters. |
| `environmentId` | `string` | Yes | Min 1 characters. |
| `enabled` | `boolean` | Yes | — |
| `schedule` | `object` | Yes | — |
| `schedule.cron` | `string` | Yes | — |
| `destination` | `object` | Yes | — |
| `destination.storageId` | `string` | No | Min 1 characters. |
| `destination.prefix` | `string` | No | max 512 characters. |
| `retention` | `object` | Yes | — |
| `retention.local` | `object` | Yes | — |
| `retention.local.count` | `integer` | Yes | Min 0; max 10000. |
| `retention.local.days` | `integer` | Yes | Min 0; max 3650. |
| `retention.local.maxStorageGb` | `number` | Yes | Min 0; max 100000. |
| `retention.remote` | `object` | Yes | — |
| `retention.remote.enabled` | `boolean` | Yes | — |
| `retention.remote.count` | `integer` | Yes | Min 0; max 10000. |
| `retention.remote.days` | `integer` | Yes | Min 0; max 3650. |
| `retention.remote.maxStorageGb` | `number` | Yes | Min 0; max 100000. |
| `volumes` | `object` | Yes | — |
| `volumes.mode` | `string` | Yes | `"none"`, `"allNamed"`, `"selected"`. |
| `volumes.names` | `string[]` | Yes | Each item: Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `databaseDumps` | `object[]` | Yes | max 100 items. |
| `databaseDumps[].service` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `databaseDumps[].engine` | `string` | Yes | `"postgres"`, `"mysql"`, `"mariadb"`, `"mongo"`. |
| `databaseDumps[].database` | `string` | Yes | Default: `""`. max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## List backups

`GET /api/v1/projects/{projectId}/backups`

List backup status metadata. Storage credentials and internal manifests are excluded.

**Permission:** `backups:read` · Team member.

**MCP:** [`list_backups`](/docs/mcp-tools/#list_backups).

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
| `items[].deploymentId` | `string or null` | Yes | Min 1; max 128 characters. |
| `items[].serverId` | `string or null` | Yes | Min 1; max 128 characters. |
| `items[].status` | `string` | Yes | `"queued"`, `"running"`, `"succeeded"`, `"failed"`, `"canceled"`. |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `items[].startedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `items[].finishedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Get backup

`GET /api/v1/backups/{backupRunId}`

Read backup status by immutable backup run ID.

**Permission:** `backups:read` · Team member.

**MCP:** [`get_backup`](/docs/mcp-tools/#get_backup).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `deploymentId` | `string or null` | Yes | Min 1; max 128 characters. |
| `serverId` | `string or null` | Yes | Min 1; max 128 characters. |
| `status` | `string` | Yes | `"queued"`, `"running"`, `"succeeded"`, `"failed"`, `"canceled"`. |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `startedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |
| `finishedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |

## List backup artifacts

`GET /api/v1/backups/{backupRunId}/artifacts`

List restore artifact identifiers, types, sizes, and checksums. Object keys and credentials are excluded.

**Permission:** `backups:read` · Team member.

**MCP:** [`list_backup_artifacts`](/docs/mcp-tools/#list_backup_artifacts).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].type` | `string` | Yes | `"manifest"`, `"volume"`, `"database"`. |
| `items[].storage` | `string` | Yes | `"local"`, `"remote"`. |
| `items[].sizeBytes` | `number` | Yes | Min 0. |
| `items[].checksumSha256` | `string` | Yes | — |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## List backup policies

`GET /api/v1/projects/{projectId}/backup-policies`

List policy identifiers and enabled state. Database connection secrets are excluded.

**Permission:** `backups:read` · Team member.

**MCP:** [`list_backup_policies`](/docs/mcp-tools/#list_backup_policies).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].name` | `string` | Yes | — |
| `items[].environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].enabled` | `boolean` | Yes | — |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## List backup storage

`GET /api/v1/backup-storage`

List team storage destination metadata without access keys. Unavailable to project-restricted credentials.

**Permission:** `backups:read` · Team member · Workspace-wide access required.

**MCP:** [`list_backup_storage`](/docs/mcp-tools/#list_backup_storage).

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `string` | Yes | Min 1; max 128 characters. |
| `items[].settingsVersion` | `integer` | Yes | Min 1. |
| `items[].name` | `string` | Yes | — |
| `items[].bucket` | `string` | Yes | — |
| `items[].region` | `string` | Yes | — |
| `items[].endpoint` | `string or null` | Yes | — |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Get job

`GET /api/v1/jobs/{jobId}`

Read an asynchronous backup or restore job status without its credential-bearing payload.

**Permission:** `backups:read` · Team member.

**MCP:** [`get_job`](/docs/mcp-tools/#get_job).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `type` | `string` | Yes | — |
| `status` | `string` | Yes | — |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `finishedAt` | `string or null` | Yes | UTC ISO 8601 timestamp. |

## Read job logs

`GET /api/v1/jobs/{jobId}/logs`

Read bounded backup or restore output. Logs may contain application secrets.

**Permission:** `logs:read` · Team member.

**MCP:** [`read_job_logs`](/docs/mcp-tools/#read_job_logs).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |

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

## Run backup

`POST /api/v1/projects/{projectId}/backups`

Queue a manual run of an enabled backup policy.

**Permission:** `backups:write` · Owner/admin.

**MCP:** [`run_backup`](/docs/mcp-tools/#run_backup).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `policyId` | `string` | No | Required when the environment has multiple enabled policies. Min 1; max 128 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 202.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | Min 1; max 128 characters. |
| `agentJobId` | `string` | Yes | Min 1; max 128 characters. |
| `statusUrl` | `string` | Yes | — |

## Restore backup

`POST /api/v1/backups/{backupRunId}/restore`

Queue a destructive restore into the current environment. Requires administrator role and explicit confirmation.

**Permission:** `backups:restore` · Owner/admin.

**MCP:** [`restore_backup`](/docs/mcp-tools/#restore_backup).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `confirmation` | `string` | Yes | Exactly `"restore"`. |
| `artifacts` | `object[]` | Yes | Min 1; max 100 items. |
| `artifacts[].artifactId` | `string` | Yes when type=`volume` | Min 1 characters. |
| `artifacts[].type` | `string` | Yes when type=`volume` | Exactly `"volume"`. |
| `artifacts[].targetVolume` | `string` | Yes when type=`volume` | Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `artifacts[].artifactId` | `string` | Yes when type=`database` | Min 1 characters. |
| `artifacts[].type` | `string` | Yes when type=`database` | Exactly `"database"`. |
| `artifacts[].targetService` | `string` | Yes when type=`database` | Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 202.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `agentJobId` | `string` | Yes | Min 1; max 128 characters. |
| `statusUrl` | `string` | Yes | — |

## Create backup policy

`POST /api/v1/projects/{projectId}/backup-policies`

Create a backup policy. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

**MCP:** [`create_backup_policy`](/docs/mcp-tools/#create_backup_policy).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Min 1; max 100 characters. |
| `environmentId` | `string` | Yes | Min 1 characters. |
| `enabled` | `boolean` | Yes | — |
| `schedule` | `object` | Yes | — |
| `schedule.cron` | `string` | Yes | — |
| `destination` | `object` | Yes | — |
| `destination.storageId` | `string` | No | Min 1 characters. |
| `destination.prefix` | `string` | No | max 512 characters. |
| `retention` | `object` | Yes | — |
| `retention.local` | `object` | Yes | — |
| `retention.local.count` | `integer` | Yes | Min 0; max 10000. |
| `retention.local.days` | `integer` | Yes | Min 0; max 3650. |
| `retention.local.maxStorageGb` | `number` | Yes | Min 0; max 100000. |
| `retention.remote` | `object` | Yes | — |
| `retention.remote.enabled` | `boolean` | Yes | — |
| `retention.remote.count` | `integer` | Yes | Min 0; max 10000. |
| `retention.remote.days` | `integer` | Yes | Min 0; max 3650. |
| `retention.remote.maxStorageGb` | `number` | Yes | Min 0; max 100000. |
| `volumes` | `object` | Yes | — |
| `volumes.mode` | `string` | Yes | `"none"`, `"allNamed"`, `"selected"`. |
| `volumes.names` | `string[]` | Yes | Each item: Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `databaseDumps` | `object[]` | Yes | — |
| `databaseDumps[].service` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `databaseDumps[].engine` | `string` | Yes | `"postgres"`, `"mysql"`, `"mariadb"`, `"mongo"`. |
| `databaseDumps[].database` | `string` | No | Default: `""`. max 128 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 201.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `policyId` | `string` | Yes | Min 1; max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Update backup policy

`PUT /api/v1/projects/{projectId}/backup-policies/{policyId}`

Replace a backup policy using its current settings version. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

**MCP:** [`update_backup_policy`](/docs/mcp-tools/#update_backup_policy).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `policyId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Min 1; max 100 characters. |
| `environmentId` | `string` | Yes | Min 1 characters. |
| `enabled` | `boolean` | Yes | — |
| `schedule` | `object` | Yes | — |
| `schedule.cron` | `string` | Yes | — |
| `destination` | `object` | Yes | — |
| `destination.storageId` | `string` | No | Min 1 characters. |
| `destination.prefix` | `string` | No | max 512 characters. |
| `retention` | `object` | Yes | — |
| `retention.local` | `object` | Yes | — |
| `retention.local.count` | `integer` | Yes | Min 0; max 10000. |
| `retention.local.days` | `integer` | Yes | Min 0; max 3650. |
| `retention.local.maxStorageGb` | `number` | Yes | Min 0; max 100000. |
| `retention.remote` | `object` | Yes | — |
| `retention.remote.enabled` | `boolean` | Yes | — |
| `retention.remote.count` | `integer` | Yes | Min 0; max 10000. |
| `retention.remote.days` | `integer` | Yes | Min 0; max 3650. |
| `retention.remote.maxStorageGb` | `number` | Yes | Min 0; max 100000. |
| `volumes` | `object` | Yes | — |
| `volumes.mode` | `string` | Yes | `"none"`, `"allNamed"`, `"selected"`. |
| `volumes.names` | `string[]` | Yes | Each item: Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `databaseDumps` | `object[]` | Yes | — |
| `databaseDumps[].service` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9_.-]*$`. Min 1; max 128 characters. |
| `databaseDumps[].engine` | `string` | Yes | `"postgres"`, `"mysql"`, `"mariadb"`, `"mongo"`. |
| `databaseDumps[].database` | `string` | No | Default: `""`. max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `policyId` | `string` | Yes | Min 1; max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Delete backup policy

`DELETE /api/v1/projects/{projectId}/backup-policies/{policyId}`

Remove a backup policy without deleting retained backup runs. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

**MCP:** [`delete_backup_policy`](/docs/mcp-tools/#delete_backup_policy).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `policyId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `confirmation` | `string` | Yes | Exactly `"delete-policy"`. |
| `settingsVersion` | `integer` | Yes | Min 1. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `policyId` | `string` | Yes | Min 1; max 128 characters. |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Create backup storage

`POST /api/v1/backup-storage`

Create a team backup destination. Secret access keys are write-only. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Min 1; max 100 characters. |
| `bucket` | `string` | Yes | Pattern: `^[a-z0-9][a-z0-9.-]*[a-z0-9]$`. Min 3; max 63 characters. |
| `region` | `string` | Yes | Min 1; max 100 characters. |
| `endpoint` | `string` | Yes | Exactly `""`. or uri. |
| `accessKeyId` | `string` | Yes | Min 1; max 256 characters. |
| `secretAccessKey` | `string` | Yes | max 1024 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 201.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `storageId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Update backup storage

`PUT /api/v1/backup-storage/{storageId}`

Rename or rotate credentials of a team backup destination. Bucket, region, and endpoint are immutable.

**Permission:** `backups:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `storageId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Min 1; max 100 characters. |
| `bucket` | `string` | Yes | Pattern: `^[a-z0-9][a-z0-9.-]*[a-z0-9]$`. Min 3; max 63 characters. |
| `region` | `string` | Yes | Min 1; max 100 characters. |
| `endpoint` | `string` | Yes | Exactly `""`. or uri. |
| `accessKeyId` | `string` | Yes | Min 1; max 256 characters. |
| `secretAccessKey` | `string` | Yes | max 1024 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `storageId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Delete backup storage

`DELETE /api/v1/backup-storage/{storageId}`

Delete an unreferenced backup destination. Policies, active backups, and retained remote artifacts prevent deletion.

**Permission:** `backups:write` · Owner/admin · Workspace-wide access required.

**MCP:** Not exposed.

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `storageId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `confirmation` | `string` | Yes | Exactly `"delete-storage"`. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `storageId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |
