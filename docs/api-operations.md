---
description: Every REST endpoint, required permission and corresponding MCP tool.
---

# API reference

Base URL: **`https://app.devpu.sh/api/v1`**. For self-hosting, replace the host with your dashboard URL. Authenticate with a bearer API key; see the [API guide](/docs/api/) for setup, errors, pagination and retries.

Select an endpoint below for its inputs and response fields. Tables use `[]` for array items and `.*` for record keys. A nested field is required only when its parent object or variant is present. Unknown request fields are rejected.

The [OpenAPI JSON](https://app.devpu.sh/api/v1/openapi.json) is also available for scripts and code generation.

## Projects

| Endpoint | Permission | MCP tool |
| --- | --- | --- |
| [`GET /api/v1/github/installations`](/docs/api-projects/#list-github-installations) | `projects:write` | — |
| [`GET /api/v1/github/repositories`](/docs/api-projects/#list-github-repositories) | `projects:write` | — |
| [`GET /api/v1/projects`](/docs/api-projects/#list-projects) | `projects:read` | [`list_projects`](/docs/mcp-tools/#list_projects) |
| [`GET /api/v1/projects/{projectId}`](/docs/api-projects/#get-project) | `projects:read` | [`get_project`](/docs/mcp-tools/#get_project) |
| [`GET /api/v1/projects/{projectId}/environments`](/docs/api-projects/#list-environments) | `projects:read` | [`list_environments`](/docs/mcp-tools/#list_environments) |
| [`GET /api/v1/projects/{projectId}/configuration`](/docs/api-projects/#get-project-configuration) | `projects:read` | [`get_project_configuration`](/docs/mcp-tools/#get_project_configuration) |
| [`GET /api/v1/projects/{projectId}/variables`](/docs/api-projects/#list-variables) | `projects:read` | [`list_variables`](/docs/mcp-tools/#list_variables) |
| [`GET /api/v1/projects/{projectId}/domains`](/docs/api-projects/#list-domains) | `projects:read` | [`list_domains`](/docs/mcp-tools/#list_domains) |
| [`GET /api/v1/projects/{projectId}/aliases`](/docs/api-projects/#list-aliases) | `projects:read` | [`list_aliases`](/docs/mcp-tools/#list_aliases) |
| [`PATCH /api/v1/projects/{projectId}`](/docs/api-projects/#rename-project) | `projects:write` | [`rename_project`](/docs/mcp-tools/#rename_project) |
| [`PATCH /api/v1/projects/{projectId}/variables`](/docs/api-projects/#update-variables) | `secrets:write` | [`update_variables`](/docs/mcp-tools/#update_variables) |
| [`PUT /api/v1/projects/{projectId}/configuration`](/docs/api-projects/#update-project-configuration) | `projects:write` | [`update_project_configuration`](/docs/mcp-tools/#update_project_configuration) |
| [`DELETE /api/v1/projects/{projectId}`](/docs/api-projects/#delete-project) | `projects:write` | [`delete_project`](/docs/mcp-tools/#delete_project) |
| [`POST /api/v1/projects`](/docs/api-projects/#create-project) | `projects:write` | [`create_project`](/docs/mcp-tools/#create_project) |
| [`PUT /api/v1/projects/{projectId}/environments`](/docs/api-projects/#update-environments) | `projects:write` | [`update_environments`](/docs/mcp-tools/#update_environments) |
| [`PUT /api/v1/projects/{projectId}/environment-servers`](/docs/api-projects/#update-environment-servers) | `projects:write` | [`update_environment_servers`](/docs/mcp-tools/#update_environment_servers) |

## Deployments and logs

| Endpoint | Permission | MCP tool |
| --- | --- | --- |
| [`GET /api/v1/projects/{projectId}/deployments`](/docs/api-deployments/#list-deployments) | `deployments:read` | [`list_deployments`](/docs/mcp-tools/#list_deployments) |
| [`GET /api/v1/deployments/{deploymentId}`](/docs/api-deployments/#get-deployment) | `deployments:read` | [`get_deployment`](/docs/mcp-tools/#get_deployment) |
| [`GET /api/v1/deployments/{deploymentId}/logs`](/docs/api-deployments/#read-deployment-logs) | `logs:read` | [`read_deployment_logs`](/docs/mcp-tools/#read_deployment_logs) |
| [`GET /api/v1/projects/{projectId}/runtime-logs`](/docs/api-deployments/#read-runtime-logs) | `logs:read` | [`read_runtime_logs`](/docs/mcp-tools/#read_runtime_logs) |
| [`POST /api/v1/projects/{projectId}/deployments`](/docs/api-deployments/#deploy) | `deployments:write` | [`deploy`](/docs/mcp-tools/#deploy) |
| [`POST /api/v1/deployments/{deploymentId}/redeploy`](/docs/api-deployments/#redeploy) | `deployments:write` | [`redeploy`](/docs/mcp-tools/#redeploy) |
| [`POST /api/v1/deployments/{deploymentId}/rollback`](/docs/api-deployments/#rollback) | `deployments:write` | [`rollback`](/docs/mcp-tools/#rollback) |
| [`GET /api/v1/projects/{projectId}/deploy-options`](/docs/api-deployments/#get-deployment-options) | `deployments:read` | [`get_deployment_options`](/docs/mcp-tools/#get_deployment_options) |

## Servers

| Endpoint | Permission | MCP tool |
| --- | --- | --- |
| [`GET /api/v1/servers`](/docs/api-servers/#list-servers) | `servers:read` | [`list_servers`](/docs/mcp-tools/#list_servers) |
| [`GET /api/v1/servers/{serverId}`](/docs/api-servers/#get-server) | `servers:read` | [`get_server`](/docs/mcp-tools/#get_server) |
| [`GET /api/v1/servers/{serverId}/metrics`](/docs/api-servers/#read-server-metrics) | `servers:read` | [`read_server_metrics`](/docs/mcp-tools/#read_server_metrics) |
| [`PATCH /api/v1/servers/{serverId}`](/docs/api-servers/#rename-server) | `servers:write` | — |
| [`POST /api/v1/servers`](/docs/api-servers/#create-server) | `servers:write` | — |
| [`POST /api/v1/servers/{serverId}/enable`](/docs/api-servers/#enable-server) | `servers:write` | — |
| [`POST /api/v1/servers/{serverId}/disable`](/docs/api-servers/#disable-server) | `servers:write` | — |
| [`DELETE /api/v1/servers/{serverId}`](/docs/api-servers/#delete-server) | `servers:write` | — |
| [`GET /api/v1/servers/{serverId}/delete-diagnostic`](/docs/api-servers/#get-server-delete-diagnostic) | `servers:write` | — |

## Backups and jobs

| Endpoint | Permission | MCP tool |
| --- | --- | --- |
| [`GET /api/v1/projects/{projectId}/backup-policies/{policyId}`](/docs/api-backups/#get-backup-policy) | `backups:read` | [`get_backup_policy`](/docs/mcp-tools/#get_backup_policy) |
| [`GET /api/v1/projects/{projectId}/backups`](/docs/api-backups/#list-backups) | `backups:read` | [`list_backups`](/docs/mcp-tools/#list_backups) |
| [`GET /api/v1/backups/{backupRunId}`](/docs/api-backups/#get-backup) | `backups:read` | [`get_backup`](/docs/mcp-tools/#get_backup) |
| [`GET /api/v1/backups/{backupRunId}/artifacts`](/docs/api-backups/#list-backup-artifacts) | `backups:read` | [`list_backup_artifacts`](/docs/mcp-tools/#list_backup_artifacts) |
| [`GET /api/v1/projects/{projectId}/backup-policies`](/docs/api-backups/#list-backup-policies) | `backups:read` | [`list_backup_policies`](/docs/mcp-tools/#list_backup_policies) |
| [`GET /api/v1/backup-storage`](/docs/api-backups/#list-backup-storage) | `backups:read` | [`list_backup_storage`](/docs/mcp-tools/#list_backup_storage) |
| [`GET /api/v1/jobs/{jobId}`](/docs/api-backups/#get-job) | `backups:read` | [`get_job`](/docs/mcp-tools/#get_job) |
| [`GET /api/v1/jobs/{jobId}/logs`](/docs/api-backups/#read-job-logs) | `logs:read` | [`read_job_logs`](/docs/mcp-tools/#read_job_logs) |
| [`POST /api/v1/projects/{projectId}/backups`](/docs/api-backups/#run-backup) | `backups:write` | [`run_backup`](/docs/mcp-tools/#run_backup) |
| [`POST /api/v1/backups/{backupRunId}/restore`](/docs/api-backups/#restore-backup) | `backups:restore` | [`restore_backup`](/docs/mcp-tools/#restore_backup) |
| [`POST /api/v1/projects/{projectId}/backup-policies`](/docs/api-backups/#create-backup-policy) | `backups:write` | [`create_backup_policy`](/docs/mcp-tools/#create_backup_policy) |
| [`PUT /api/v1/projects/{projectId}/backup-policies/{policyId}`](/docs/api-backups/#update-backup-policy) | `backups:write` | [`update_backup_policy`](/docs/mcp-tools/#update_backup_policy) |
| [`DELETE /api/v1/projects/{projectId}/backup-policies/{policyId}`](/docs/api-backups/#delete-backup-policy) | `backups:write` | [`delete_backup_policy`](/docs/mcp-tools/#delete_backup_policy) |
| [`POST /api/v1/backup-storage`](/docs/api-backups/#create-backup-storage) | `backups:write` | — |
| [`PUT /api/v1/backup-storage/{storageId}`](/docs/api-backups/#update-backup-storage) | `backups:write` | — |
| [`DELETE /api/v1/backup-storage/{storageId}`](/docs/api-backups/#delete-backup-storage) | `backups:write` | — |

## Identity

| Endpoint | Permission | MCP tool |
| --- | --- | --- |
| [`GET /api/v1/identity`](/docs/api-operations/#get-identity) | `projects:read` | [`get_identity`](/docs/mcp-tools/#get_identity) |

## Get identity

`GET /api/v1/identity`

Read the authenticated user, selected team, and effective credential scopes.

**Permission:** `projects:read` · Team member.

**MCP:** [`get_identity`](/docs/mcp-tools/#get_identity).

**Query parameters**

None.

**Response:** HTTP 200.

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `user` | `object` | Yes | — |
| `user.id` | `string` | Yes | Min 1; max 128 characters. |
| `user.name` | `string` | Yes | — |
| `user.username` | `string` | Yes | — |
| `team` | `object` | Yes | — |
| `team.id` | `string` | Yes | Min 1; max 128 characters. |
| `team.name` | `string` | Yes | — |
| `team.slug` | `string` | Yes | — |
| `scopes` | `string[]` | Yes | — |
| `projectIds` | `string[] or null` | Yes | Each item: Min 1; max 128 characters. |
