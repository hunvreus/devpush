---
description: All MCP tool names, arguments, permissions and results.
---

# MCP tools

[Connect your assistant](/docs/mcp/) and select its permissions first. Each tool below lists its arguments and links to the full input constraints and JSON result.

Arguments are one JSON object, combining REST path, query and body fields. Use `idempotencyKey` for writes. Argument tables show required fields, defaults and confirmation values. Deployment, backup and restore calls queue work: follow the returned resource/job ID to check success.

## Tool index

**Projects**

| Tool | Purpose |
| --- | --- |
| [`list_projects`](#list_projects) | List authorized active projects using a bounded cursor |
| [`get_project`](#get_project) | Read public project metadata |
| [`list_environments`](#list_environments) | List the active environments for a project |
| [`get_project_configuration`](#get_project_configuration) | Read the supported Compose runtime configuration and routes |
| [`list_variables`](#list_variables) | List variable names and environment scopes |
| [`list_domains`](#list_domains) | List custom domains and their verification status |
| [`list_aliases`](#list_aliases) | List generated deployment, branch, and environment aliases |
| [`rename_project`](#rename_project) | Rename a project using its current settings version |
| [`update_variables`](#update_variables) | Patch write-only variables |
| [`update_project_configuration`](#update_project_configuration) | Replace Compose runtime configuration and routes with settings version protection |
| [`delete_project`](#delete_project) | Delete a project and optionally queue deployed runtime removal |
| [`create_project`](#create_project) | Create a Compose project from a repository accessible to the owner’s linked GitHub account |
| [`update_environments`](#update_environments) | Replace environment definitions with project settings version protection |
| [`update_environment_servers`](#update_environment_servers) | Update default and per-environment server assignments, regenerating environment aliases |

**Deployments and logs**

| Tool | Purpose |
| --- | --- |
| [`list_deployments`](#list_deployments) | List deployment metadata |
| [`get_deployment`](#get_deployment) | Read deployment status by immutable deployment ID |
| [`read_deployment_logs`](#read_deployment_logs) | Read bounded build or control log entries |
| [`read_runtime_logs`](#read_runtime_logs) | Read bounded runtime output from current environment server assignments |
| [`deploy`](#deploy) | Queue a deployment from a matching GitHub branch |
| [`redeploy`](#redeploy) | Queue the recorded commit and runtime settings with current routing |
| [`rollback`](#rollback) | Queue a successful recorded commit and runtime settings with current routing |
| [`get_deployment_options`](#get_deployment_options) | List one provider page of matching branches and recent commits only for the selected branch |

**Servers**

| Tool | Purpose |
| --- | --- |
| [`list_servers`](#list_servers) | List team server metadata |
| [`get_server`](#get_server) | Read server metadata |
| [`read_server_metrics`](#read_server_metrics) | Read bounded host metric samples |

**Backups and jobs**

| Tool | Purpose |
| --- | --- |
| [`get_backup_policy`](#get_backup_policy) | Read a backup policy without commands or storage credentials |
| [`list_backups`](#list_backups) | List backup status metadata |
| [`get_backup`](#get_backup) | Read backup status by immutable backup run ID |
| [`list_backup_artifacts`](#list_backup_artifacts) | List restore artifact identifiers, types, sizes, and checksums |
| [`list_backup_policies`](#list_backup_policies) | List policy identifiers and enabled state |
| [`list_backup_storage`](#list_backup_storage) | List team storage destination metadata without access keys |
| [`get_job`](#get_job) | Read an asynchronous backup or restore job status without its credential-bearing payload |
| [`read_job_logs`](#read_job_logs) | Read bounded backup or restore output |
| [`run_backup`](#run_backup) | Queue a manual run of an enabled backup policy |
| [`restore_backup`](#restore_backup) | Queue a destructive restore into the current environment |
| [`create_backup_policy`](#create_backup_policy) | Create a backup policy |
| [`update_backup_policy`](#update_backup_policy) | Replace a backup policy using its current settings version |
| [`delete_backup_policy`](#delete_backup_policy) | Remove a backup policy without deleting retained backup runs |

**Identity**

| Tool | Purpose |
| --- | --- |
| [`get_identity`](#get_identity) | Read the authenticated user, selected team, and effective credential scopes |

## Projects

### list_projects

List authorized active projects using a bounded cursor.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-projects/#list-projects).

### get_project

Read public project metadata. Secret values and private configuration snapshots are excluded.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#get-project).

### list_environments

List the active environments for a project.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-projects/#list-environments).

### get_project_configuration

Read the supported Compose runtime configuration and routes.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#get-project-configuration).

### list_variables

List variable names and environment scopes. Values are never returned.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-projects/#list-variables).

### list_domains

List custom domains and their verification status.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-projects/#list-domains).

### list_aliases

List generated deployment, branch, and environment aliases.

**Permission:** `projects:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-projects/#list-aliases).

### rename_project

Rename a project using its current settings version. Resource IDs stay unchanged.

**Permission:** `projects:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `name` | `string` | Yes | — |
| `settingsVersion` | `integer` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#rename-project).

### update_variables

Patch write-only variables. Omitted values are preserved; deleted names are removed only in their chosen environment scope.

**Permission:** `secrets:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `settingsVersion` | `integer` | Yes | — |
| `changes` | `object[]` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#update-variables).

### update_project_configuration

Replace Compose runtime configuration and routes with settings version protection. Host lifecycle command changes require their separate administrator scope.

**Permission:** `projects:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `settingsVersion` | `integer` | Yes | — |
| `runtimeConfig` | `object` | Yes | — |
| `routes` | `object[]` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#update-project-configuration).

### delete_project

Delete a project and optionally queue deployed runtime removal. Requires current administrator role and the project name as confirmation.

**Permission:** `projects:write` · Owner/admin.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `confirmationName` | `string` | Yes | — |
| `removeDeployments` | `boolean` | No | Default: `true`. |
| `idempotencyKey` | `string` | Yes | — |
| `confirmation` | `string` | Yes | Exactly `"delete_project"`. |

[Full inputs and result](/docs/api-projects/#delete-project).

### create_project

Create a Compose project from a repository accessible to the owner’s linked GitHub account. Browser GitHub connection and installation consent must already be complete.

**Permission:** `projects:write` · Team member · Workspace-wide access required.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `installationId` | `integer` | Yes | — |
| `serverId` | `string or null` | No | — |
| `composePath` | `string` | No | — |
| `readinessPath` | `string` | No | — |
| `releaseCommand` | `string` | No | — |
| `releaseService` | `string` | No | — |
| `envVars` | `object[]` | No | — |
| `projectName` | `string` | Yes | — |
| `repoFullName` | `string` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#create-project).

### update_environments

Replace environment definitions with project settings version protection. Omitted server assignments are preserved. Production is required.

**Permission:** `projects:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `environments` | `object[]` | Yes | — |
| `settingsVersion` | `integer` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |
| `confirmation` | `string` | Yes | Exactly `"update_environments"`. |

[Full inputs and result](/docs/api-projects/#update-environments).

### update_environment_servers

Update default and per-environment server assignments, regenerating environment aliases. Unspecified environment assignments are preserved.

**Permission:** `projects:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `defaultServerId` | `string or null` | Yes | — |
| `environmentServers` | `object[]` | Yes | — |
| `settingsVersion` | `integer` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-projects/#update-environment-servers).

## Deployments and logs

### list_deployments

List deployment metadata. Build snapshots and variable values are excluded.

**Permission:** `deployments:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |
| `environmentId` | `string` | No | — |

[Full inputs and result](/docs/api-deployments/#list-deployments).

### get_deployment

Read deployment status by immutable deployment ID.

**Permission:** `deployments:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | — |

[Full inputs and result](/docs/api-deployments/#get-deployment).

### read_deployment_logs

Read bounded build or control log entries. Application output may contain secrets.

**Permission:** `logs:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |
| `stream` | `string` | No | Default: `"build"`. Exactly `"build"`. |

[Full inputs and result](/docs/api-deployments/#read-deployment-logs).

### read_runtime_logs

Read bounded runtime output from current environment server assignments. Application output may contain secrets.

**Permission:** `logs:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |
| `environmentId` | `string` | No | — |
| `service` | `string` | No | — |
| `keyword` | `string` | No | — |
| `since` | `string` | No | — |

[Full inputs and result](/docs/api-deployments/#read-runtime-logs).

### deploy

Queue a deployment from a matching GitHub branch. Requires a unique idempotencyKey; returns acceptance, not execution success.

**Permission:** `deployments:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `environmentId` | `string` | Yes | — |
| `branch` | `string` | Yes | — |
| `sha` | `string` | No | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-deployments/#deploy).

### redeploy

Queue the recorded commit and runtime settings with current routing.

**Permission:** `deployments:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-deployments/#redeploy).

### rollback

Queue a successful recorded commit and runtime settings with current routing.

**Permission:** `deployments:write` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `deploymentId` | `string` | Yes | — |
| `confirmation` | `string` | Yes | Exactly `"rollback"`. |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-deployments/#rollback).

### get_deployment_options

List one provider page of matching branches and recent commits only for the selected branch. Continue with nextCursor to reach later matching branches, including after empty filtered pages.

**Permission:** `deployments:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |
| `environmentId` | `string` | Yes | — |
| `branch` | `string` | No | — |

[Full inputs and result](/docs/api-deployments/#get-deployment-options).

## Servers

### list_servers

List team server metadata. Unavailable to project-restricted credentials.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-servers/#list-servers).

### get_server

Read server metadata. Enrollment and agent credentials are excluded.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | — |

[Full inputs and result](/docs/api-servers/#get-server).

### read_server_metrics

Read bounded host metric samples.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `serverId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |
| `since` | `string` | No | — |

[Full inputs and result](/docs/api-servers/#read-server-metrics).

## Backups and jobs

### get_backup_policy

Read a backup policy without commands or storage credentials.

**Permission:** `backups:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `policyId` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#get-backup-policy).

### list_backups

List backup status metadata. Storage credentials and internal manifests are excluded.

**Permission:** `backups:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |
| `environmentId` | `string` | No | — |

[Full inputs and result](/docs/api-backups/#list-backups).

### get_backup

Read backup status by immutable backup run ID.

**Permission:** `backups:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#get-backup).

### list_backup_artifacts

List restore artifact identifiers, types, sizes, and checksums. Object keys and credentials are excluded.

**Permission:** `backups:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-backups/#list-backup-artifacts).

### list_backup_policies

List policy identifiers and enabled state. Database connection secrets are excluded.

**Permission:** `backups:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-backups/#list-backup-policies).

### list_backup_storage

List team storage destination metadata without access keys. Unavailable to project-restricted credentials.

**Permission:** `backups:read` · Team member · Workspace-wide access required.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-backups/#list-backup-storage).

### get_job

Read an asynchronous backup or restore job status without its credential-bearing payload.

**Permission:** `backups:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#get-job).

### read_job_logs

Read bounded backup or restore output. Logs may contain application secrets.

**Permission:** `logs:read` · Team member.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `jobId` | `string` | Yes | — |
| `limit` | `integer` | No | Default: `25`. |
| `cursor` | `string` | No | — |

[Full inputs and result](/docs/api-backups/#read-job-logs).

### run_backup

Queue a manual run of an enabled backup policy.

**Permission:** `backups:write` · Owner/admin.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `environmentId` | `string` | Yes | — |
| `policyId` | `string` | No | Required when the environment has multiple enabled policies. |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#run-backup).

### restore_backup

Queue a destructive restore into the current environment. Requires administrator role and explicit confirmation.

**Permission:** `backups:restore` · Owner/admin.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `backupRunId` | `string` | Yes | — |
| `confirmation` | `string` | Yes | Exactly `"restore"`. |
| `artifacts` | `object[]` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#restore-backup).

### create_backup_policy

Create a backup policy. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `name` | `string` | Yes | — |
| `environmentId` | `string` | Yes | — |
| `enabled` | `boolean` | Yes | — |
| `schedule` | `object` | Yes | — |
| `destination` | `object` | Yes | — |
| `retention` | `object` | Yes | — |
| `volumes` | `object` | Yes | — |
| `databaseDumps` | `object[]` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#create-backup-policy).

### update_backup_policy

Replace a backup policy using its current settings version. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `name` | `string` | Yes | — |
| `environmentId` | `string` | Yes | — |
| `enabled` | `boolean` | Yes | — |
| `schedule` | `object` | Yes | — |
| `destination` | `object` | Yes | — |
| `retention` | `object` | Yes | — |
| `volumes` | `object` | Yes | — |
| `databaseDumps` | `object[]` | Yes | — |
| `policyId` | `string` | Yes | — |
| `settingsVersion` | `integer` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#update-backup-policy).

### delete_backup_policy

Remove a backup policy without deleting retained backup runs. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

| Argument | Type | Required | Details |
| --- | --- | --- | --- |
| `projectId` | `string` | Yes | — |
| `policyId` | `string` | Yes | — |
| `confirmation` | `string` | Yes | Exactly `"delete-policy"`. |
| `settingsVersion` | `integer` | Yes | — |
| `idempotencyKey` | `string` | Yes | — |

[Full inputs and result](/docs/api-backups/#delete-backup-policy).

## Identity

### get_identity

Read the authenticated user, selected team, and effective credential scopes.

**Permission:** `projects:read` · Team member.

None.

[Full inputs and result](/docs/api-operations/#get-identity).
