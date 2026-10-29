---
description: Projects endpoints, input fields and response shapes.
---

# Projects API

See the [API guide](/docs/api/) for authentication and retries, or the [endpoint index](/docs/api-operations/) for other resources. All paths below are relative to your dashboard host.

## List GitHub installations

`GET /api/v1/github/installations`

List one provider page of linked GitHub installations available when creating projects. Requires unrestricted team management access.

**Permission:** `projects:write` · Team member · Workspace-wide access required.

**MCP:** Not exposed.

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `integer` | Yes | Min -9007199254740991. |
| `items[].accountLogin` | `string` | Yes | — |
| `items[].accountType` | `string` | Yes | — |
| `items[].repositorySelection` | `string` | Yes | — |
| `nextCursor` | `string or null` | Yes | — |

## List GitHub repositories

`GET /api/v1/github/repositories`

List one provider page of repositories with push access in a linked installation. Continue with nextCursor even when a filtered page is empty.

**Permission:** `projects:write` · Team member · Workspace-wide access required.

**MCP:** Not exposed.

**Query parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. Min 1; max 100. |
| `cursor` | `string` | No | Min 1; max 2048 characters. |
| `installationId` | `integer` | Yes | Greater than 0. |

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `items` | `object[]` | Yes | max 100 items. |
| `items[].id` | `integer` | Yes | Min -9007199254740991. |
| `items[].installationId` | `integer` | Yes | Min -9007199254740991. |
| `items[].fullName` | `string` | Yes | — |
| `items[].defaultBranch` | `string` | Yes | — |
| `items[].private` | `boolean` | Yes | — |
| `nextCursor` | `string or null` | Yes | — |

## List projects

`GET /api/v1/projects`

List authorized active projects using a bounded cursor.

**Permission:** `projects:read` · Team member.

**MCP:** [`list_projects`](/docs/mcp-tools/#list_projects).

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
| `items[].teamId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].name` | `string` | Yes | — |
| `items[].slug` | `string` | Yes | — |
| `items[].repository` | `string` | Yes | — |
| `items[].repositoryId` | `integer or null` | Yes | Min -9007199254740991. |
| `items[].defaultServerId` | `string or null` | Yes | Min 1; max 128 characters. |
| `items[].settingsVersion` | `integer` | Yes | Min 1. |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Get project

`GET /api/v1/projects/{projectId}`

Read public project metadata. Secret values and private configuration snapshots are excluded.

**Permission:** `projects:read` · Team member.

**MCP:** [`get_project`](/docs/mcp-tools/#get_project).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `teamId` | `string` | Yes | Min 1; max 128 characters. |
| `name` | `string` | Yes | — |
| `slug` | `string` | Yes | — |
| `repository` | `string` | Yes | — |
| `repositoryId` | `integer or null` | Yes | Min -9007199254740991. |
| `defaultServerId` | `string or null` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |

## List environments

`GET /api/v1/projects/{projectId}/environments`

List the active environments for a project.

**Permission:** `projects:read` · Team member.

**MCP:** [`list_environments`](/docs/mcp-tools/#list_environments).

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
| `items[].projectId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].name` | `string` | Yes | — |
| `items[].slug` | `string` | Yes | — |
| `items[].branch` | `string` | Yes | — |
| `items[].isProduction` | `boolean` | Yes | — |
| `items[].position` | `integer` | Yes | Min -9007199254740991. |
| `items[].color` | `string` | Yes | — |
| `items[].serverId` | `string or null` | Yes | Min 1; max 128 characters. |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Get project configuration

`GET /api/v1/projects/{projectId}/configuration`

Read the supported Compose runtime configuration and routes.

**Permission:** `projects:read` · Team member.

**MCP:** [`get_project_configuration`](/docs/mcp-tools/#get_project_configuration).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `runtimeConfig` | `object` | Yes | — |
| `runtimeConfig.type` | `string` | Yes | Exactly `"compose"`. |
| `runtimeConfig.path` | `string or null` | Yes | Min 1; max 255 characters. |
| `runtimeConfig.releaseCommand` | `string or null` | Yes | max 16384 characters. |
| `runtimeConfig.releaseService` | `string or null` | Yes | Min 1 characters. |
| `runtimeConfig.readinessPath` | `string or null` | Yes | Pattern: `^\/`. |
| `runtimeConfig.deployCommand` | `string or null` | Yes | max 16384 characters. |
| `runtimeConfig.rollbackCommand` | `string or null` | Yes | max 16384 characters. |
| `runtimeConfig.timeoutSeconds` | `integer` | Yes | Min 60; max 7200. |
| `routes` | `object[]` | Yes | — |
| `routes[].service` | `string` | Yes | Pattern: `^[A-Za-z0-9._-]+$`. Min 1 characters. |
| `routes[].port` | `integer` | Yes | Min 1; max 65535. |
| `routes[].path` | `string` | Yes | Min 1 characters. |
| `routes[].stripPrefix` | `boolean` | Yes | Default: `false`. |
| `routes[].environmentId` | `string` | No | Min 1 characters. |

## List variables

`GET /api/v1/projects/{projectId}/variables`

List variable names and environment scopes. Values are never returned.

**Permission:** `projects:read` · Team member.

**MCP:** [`list_variables`](/docs/mcp-tools/#list_variables).

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
| `items[].key` | `string` | Yes | — |
| `items[].environmentId` | `string or null` | Yes | Min 1; max 128 characters. |
| `nextCursor` | `string or null` | Yes | — |
| `settingsVersion` | `integer` | Yes | Min 1. |

## List domains

`GET /api/v1/projects/{projectId}/domains`

List custom domains and their verification status.

**Permission:** `projects:read` · Team member.

**MCP:** [`list_domains`](/docs/mcp-tools/#list_domains).

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
| `items[].environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].hostname` | `string or null` | Yes | — |
| `items[].basePath` | `string or null` | Yes | — |
| `items[].https` | `boolean` | Yes | — |
| `items[].status` | `string` | Yes | — |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## List aliases

`GET /api/v1/projects/{projectId}/aliases`

List generated deployment, branch, and environment aliases.

**Permission:** `projects:read` · Team member.

**MCP:** [`list_aliases`](/docs/mcp-tools/#list_aliases).

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
| `items[].environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `items[].deploymentId` | `string or null` | Yes | Min 1; max 128 characters. |
| `items[].hostname` | `string or null` | Yes | — |
| `items[].type` | `string` | Yes | `"deployment"`, `"environment"`, `"branch"`. |
| `items[].branch` | `string or null` | Yes | — |
| `items[].https` | `boolean` | Yes | — |
| `items[].createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |
| `nextCursor` | `string or null` | Yes | — |

## Rename project

`PATCH /api/v1/projects/{projectId}`

Rename a project using its current settings version. Resource IDs stay unchanged.

**Permission:** `projects:write` · Team member.

**MCP:** [`rename_project`](/docs/mcp-tools/#rename_project).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$`. Min 2; max 100 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Min 1; max 128 characters. |
| `teamId` | `string` | Yes | Min 1; max 128 characters. |
| `name` | `string` | Yes | — |
| `slug` | `string` | Yes | — |
| `repository` | `string` | Yes | — |
| `repositoryId` | `integer or null` | Yes | Min -9007199254740991. |
| `defaultServerId` | `string or null` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `createdAt` | `string` | Yes | UTC ISO 8601 timestamp. |

## Update variables

`PATCH /api/v1/projects/{projectId}/variables`

Patch write-only variables. Omitted values are preserved; deleted names are removed only in their chosen environment scope.

**Permission:** `secrets:write` · Team member.

**MCP:** [`update_variables`](/docs/mcp-tools/#update_variables).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `changes` | `object[]` | Yes | Min 1; max 100 items. |
| `changes[].key` | `string` | Yes | Pattern: `^[A-Za-z_][A-Za-z0-9_]*$`. max 255 characters. |
| `changes[].environmentId` | `string or null` | Yes | Min 1; max 128 characters. |
| `changes[].value` | `string or null` | Yes | max 65536 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Update project configuration

`PUT /api/v1/projects/{projectId}/configuration`

Replace Compose runtime configuration and routes with settings version protection. Host lifecycle command changes require their separate administrator scope.

**Permission:** `projects:write` · Team member.

**MCP:** [`update_project_configuration`](/docs/mcp-tools/#update_project_configuration).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `settingsVersion` | `integer` | Yes | Min 1. |
| `runtimeConfig` | `object` | Yes | — |
| `runtimeConfig.type` | `string` | Yes | Exactly `"compose"`. |
| `runtimeConfig.path` | `string or null` | Yes | Min 1; max 255 characters. |
| `runtimeConfig.releaseCommand` | `string or null` | Yes | max 16384 characters. |
| `runtimeConfig.releaseService` | `string or null` | Yes | Min 1 characters. |
| `runtimeConfig.readinessPath` | `string or null` | Yes | Pattern: `^\/`. |
| `runtimeConfig.deployCommand` | `string or null` | Yes | max 16384 characters. |
| `runtimeConfig.rollbackCommand` | `string or null` | Yes | max 16384 characters. |
| `runtimeConfig.timeoutSeconds` | `integer` | Yes | Min 60; max 7200. |
| `routes` | `object[]` | Yes | max 100 items. |
| `routes[].service` | `string` | Yes | Pattern: `^[A-Za-z0-9._-]+$`. Min 1 characters. |
| `routes[].port` | `integer` | Yes | Min 1; max 65535. |
| `routes[].path` | `string` | Yes | Min 1 characters. |
| `routes[].stripPrefix` | `boolean` | No | Default: `false`. |
| `routes[].environmentId` | `string` | No | Min 1 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Delete project

`DELETE /api/v1/projects/{projectId}`

Delete a project and optionally queue deployed runtime removal. Requires current administrator role and the project name as confirmation.

**Permission:** `projects:write` · Owner/admin.

**MCP:** [`delete_project`](/docs/mcp-tools/#delete_project).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `confirmationName` | `string` | Yes | Min 1; max 100 characters. |
| `removeDeployments` | `boolean` | No | Default: `true`. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `status` | `string` | Yes | Exactly `"deleted"`. |

## Create project

`POST /api/v1/projects`

Create a Compose project from a repository accessible to the owner’s linked GitHub account. Browser GitHub connection and installation consent must already be complete.

**Permission:** `projects:write` · Team member · Workspace-wide access required.

**MCP:** [`create_project`](/docs/mcp-tools/#create_project).

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `installationId` | `integer` | Yes | Greater than 0. |
| `serverId` | `string or null` | No | — |
| `composePath` | `string` | No | Min 1; max 255 characters. or Exactly `""`. |
| `readinessPath` | `string` | No | — |
| `releaseCommand` | `string` | No | max 16384 characters. |
| `releaseService` | `string` | No | — |
| `envVars` | `object[]` | No | max 100 items. |
| `envVars[].key` | `string` | Yes | Pattern: `^[A-Za-z_][A-Za-z0-9_]*$`. Min 1 characters. |
| `envVars[].value` | `string` | Yes | — |
| `envVars[].environment` | `string` | No | — |
| `projectName` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$`. Min 2; max 100 characters. |
| `repoFullName` | `string` | Yes | Pattern: `^[^/\s]+\/[^/\s]+$`. Min 1 characters. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 201.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `statusUrl` | `string` | Yes | — |

## Update environments

`PUT /api/v1/projects/{projectId}/environments`

Replace environment definitions with project settings version protection. Omitted server assignments are preserved. Production is required.

**Permission:** `projects:write` · Team member.

**MCP:** [`update_environments`](/docs/mcp-tools/#update_environments).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `environments` | `object[]` | Yes | Min 1; max 100 items. |
| `environments[].id` | `string` | Yes | Min 1 characters. |
| `environments[].name` | `string` | Yes | Min 1; max 255 characters. |
| `environments[].slug` | `string` | Yes | Pattern: `^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$`. Min 2; max 255 characters. |
| `environments[].branch` | `string` | Yes | Min 1; max 255 characters. |
| `environments[].color` | `string` | Yes | Min 1; max 32 characters. |
| `environments[].position` | `integer` | Yes | Min 0. |
| `environments[].status` | `string` | Yes | `"active"`, `"deleted"`. |
| `settingsVersion` | `integer` | Yes | Min 1. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

## Update environment servers

`PUT /api/v1/projects/{projectId}/environment-servers`

Update default and per-environment server assignments, regenerating environment aliases. Unspecified environment assignments are preserved.

**Permission:** `projects:write` · Team member.

**MCP:** [`update_environment_servers`](/docs/mcp-tools/#update_environment_servers).

**Path parameters**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |

**JSON body**

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `defaultServerId` | `string or null` | Yes | Min 1; max 128 characters. |
| `environmentServers` | `object[]` | Yes | max 100 items. |
| `environmentServers[].environmentId` | `string` | Yes | Min 1; max 128 characters. |
| `environmentServers[].serverId` | `string or null` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |

Send `Idempotency-Key` as a header, not a body field.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | Min 1; max 128 characters. |
| `settingsVersion` | `integer` | Yes | Min 1. |
