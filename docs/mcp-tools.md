---
description: All MCP tool names, arguments, permissions and results.
---

# MCP tool reference

[Connect your assistant](/docs/mcp/) and select its permissions first. Each tool below lists its arguments and links to the full input constraints and JSON result.

Arguments are one JSON object, combining REST path, query and body fields. Use `idempotencyKey` for writes. Arguments marked **required** must be supplied; confirmation values are shown explicitly. Deployment, backup and restore calls queue work: follow the returned resource/job ID to check success.

## Projects

### list_projects

List authorized active projects using a bounded cursor.

**Permission:** `projects:read` · Team member.

**Arguments:** `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-projects/#list-projects).

### get_project

Read public project metadata. Secret values and private configuration snapshots are excluded.

**Permission:** `projects:read` · Team member.

**Arguments:** `projectId` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#get-project).

### list_environments

List the active environments for a project.

**Permission:** `projects:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-projects/#list-environments).

### get_project_configuration

Read the supported Compose runtime configuration and routes.

**Permission:** `projects:read` · Team member.

**Arguments:** `projectId` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#get-project-configuration).

### list_variables

List variable names and environment scopes. Values are never returned.

**Permission:** `projects:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-projects/#list-variables).

### list_domains

List custom domains and their verification status.

**Permission:** `projects:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-projects/#list-domains).

### list_aliases

List generated deployment, branch, and environment aliases.

**Permission:** `projects:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-projects/#list-aliases).

### rename_project

Rename a project using its current settings version. Resource IDs stay unchanged.

**Permission:** `projects:write` · Team member.

**Arguments:** `projectId` (`string`, **required**); `name` (`string`, **required**); `settingsVersion` (`integer`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#rename-project).

### update_variables

Patch write-only variables. Omitted values are preserved; deleted names are removed only in their chosen environment scope.

**Permission:** `secrets:write` · Team member.

**Arguments:** `projectId` (`string`, **required**); `settingsVersion` (`integer`, **required**); `changes` (`object[]`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#update-variables).

### update_project_configuration

Replace Compose runtime configuration and routes with settings version protection. Host lifecycle command changes require their separate administrator scope.

**Permission:** `projects:write` · Team member.

**Arguments:** `projectId` (`string`, **required**); `settingsVersion` (`integer`, **required**); `runtimeConfig` (`object`, **required**); `routes` (`object[]`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#update-project-configuration).

### delete_project

Delete a project and optionally queue deployed runtime removal. Requires current administrator role and the project name as confirmation.

**Permission:** `projects:write` · Owner/admin.

**Arguments:** `projectId` (`string`, **required**); `confirmationName` (`string`, **required**); `removeDeployments` (`boolean`); `idempotencyKey` (`string`, **required**); `confirmation` (`string`, **required**, `"delete_project"`).

[Full inputs and result](/docs/api-projects/#delete-project).

### create_project

Create a Compose project from a repository accessible to the owner’s linked GitHub account. Browser GitHub connection and installation consent must already be complete.

**Permission:** `projects:write` · Team member · Workspace-wide access required.

**Arguments:** `installationId` (`integer`, **required**); `serverId` (`string or null`); `composePath` (`string`); `readinessPath` (`string`); `releaseCommand` (`string`); `releaseService` (`string`); `envVars` (`object[]`); `projectName` (`string`, **required**); `repoFullName` (`string`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#create-project).

### update_environments

Replace environment definitions with project settings version protection. Omitted server assignments are preserved. Production is required.

**Permission:** `projects:write` · Team member.

**Arguments:** `projectId` (`string`, **required**); `environments` (`object[]`, **required**); `settingsVersion` (`integer`, **required**); `idempotencyKey` (`string`, **required**); `confirmation` (`string`, **required**, `"update_environments"`).

[Full inputs and result](/docs/api-projects/#update-environments).

### update_environment_servers

Update default and per-environment server assignments, regenerating environment aliases. Unspecified environment assignments are preserved.

**Permission:** `projects:write` · Team member.

**Arguments:** `projectId` (`string`, **required**); `defaultServerId` (`string or null`, **required**); `environmentServers` (`object[]`, **required**); `settingsVersion` (`integer`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-projects/#update-environment-servers).

## Deployments and logs

### list_deployments

List deployment metadata. Build snapshots and variable values are excluded.

**Permission:** `deployments:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`); `environmentId` (`string`).

[Full inputs and result](/docs/api-deployments/#list-deployments).

### get_deployment

Read deployment status by immutable deployment ID.

**Permission:** `deployments:read` · Team member.

**Arguments:** `deploymentId` (`string`, **required**).

[Full inputs and result](/docs/api-deployments/#get-deployment).

### read_deployment_logs

Read bounded build or control log entries. Application output may contain secrets.

**Permission:** `logs:read` · Team member.

**Arguments:** `deploymentId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`); `stream` (`string`).

[Full inputs and result](/docs/api-deployments/#read-deployment-logs).

### read_runtime_logs

Read bounded runtime output from current environment server assignments. Application output may contain secrets.

**Permission:** `logs:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`); `environmentId` (`string`); `service` (`string`); `keyword` (`string`); `since` (`string`).

[Full inputs and result](/docs/api-deployments/#read-runtime-logs).

### deploy

Queue a deployment from a matching GitHub branch. Requires a unique idempotencyKey; returns acceptance, not execution success.

**Permission:** `deployments:write` · Team member.

**Arguments:** `projectId` (`string`, **required**); `environmentId` (`string`, **required**); `branch` (`string`, **required**); `sha` (`string`); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-deployments/#deploy).

### redeploy

Queue the recorded commit and runtime settings with current routing.

**Permission:** `deployments:write` · Team member.

**Arguments:** `deploymentId` (`string`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-deployments/#redeploy).

### rollback

Queue a successful recorded commit and runtime settings with current routing.

**Permission:** `deployments:write` · Team member.

**Arguments:** `deploymentId` (`string`, **required**); `confirmation` (`string`, **required**, `"rollback"`); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-deployments/#rollback).

### get_deployment_options

List one provider page of matching branches and recent commits only for the selected branch. Continue with nextCursor to reach later matching branches, including after empty filtered pages.

**Permission:** `deployments:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`); `environmentId` (`string`, **required**); `branch` (`string`).

[Full inputs and result](/docs/api-deployments/#get-deployment-options).

## Servers

### list_servers

List team server metadata. Unavailable to project-restricted credentials.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

**Arguments:** `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-servers/#list-servers).

### get_server

Read server metadata. Enrollment and agent credentials are excluded.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

**Arguments:** `serverId` (`string`, **required**).

[Full inputs and result](/docs/api-servers/#get-server).

### read_server_metrics

Read bounded host metric samples.

**Permission:** `servers:read` · Team member · Workspace-wide access required.

**Arguments:** `serverId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`); `since` (`string`).

[Full inputs and result](/docs/api-servers/#read-server-metrics).

## Backups and jobs

### get_backup_policy

Read a backup policy without commands or storage credentials.

**Permission:** `backups:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `policyId` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#get-backup-policy).

### list_backups

List backup status metadata. Storage credentials and internal manifests are excluded.

**Permission:** `backups:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`); `environmentId` (`string`).

[Full inputs and result](/docs/api-backups/#list-backups).

### get_backup

Read backup status by immutable backup run ID.

**Permission:** `backups:read` · Team member.

**Arguments:** `backupRunId` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#get-backup).

### list_backup_artifacts

List restore artifact identifiers, types, sizes, and checksums. Object keys and credentials are excluded.

**Permission:** `backups:read` · Team member.

**Arguments:** `backupRunId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-backups/#list-backup-artifacts).

### list_backup_policies

List policy identifiers and enabled state. Database connection secrets are excluded.

**Permission:** `backups:read` · Team member.

**Arguments:** `projectId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-backups/#list-backup-policies).

### list_backup_storage

List team storage destination metadata without access keys. Unavailable to project-restricted credentials.

**Permission:** `backups:read` · Team member · Workspace-wide access required.

**Arguments:** `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-backups/#list-backup-storage).

### get_job

Read an asynchronous backup or restore job status without its credential-bearing payload.

**Permission:** `backups:read` · Team member.

**Arguments:** `jobId` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#get-job).

### read_job_logs

Read bounded backup or restore output. Logs may contain application secrets.

**Permission:** `logs:read` · Team member.

**Arguments:** `jobId` (`string`, **required**); `limit` (`integer`); `cursor` (`string`).

[Full inputs and result](/docs/api-backups/#read-job-logs).

### run_backup

Queue a manual run of an enabled backup policy.

**Permission:** `backups:write` · Owner/admin.

**Arguments:** `projectId` (`string`, **required**); `environmentId` (`string`, **required**); `policyId` (`string`); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#run-backup).

### restore_backup

Queue a destructive restore into the current environment. Requires administrator role and explicit confirmation.

**Permission:** `backups:restore` · Owner/admin.

**Arguments:** `backupRunId` (`string`, **required**); `confirmation` (`string`, **required**, `"restore"`); `artifacts` (`object[]`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#restore-backup).

### create_backup_policy

Create a backup policy. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

**Arguments:** `projectId` (`string`, **required**); `name` (`string`, **required**); `environmentId` (`string`, **required**); `enabled` (`boolean`, **required**); `schedule` (`object`, **required**); `destination` (`object`, **required**); `retention` (`object`, **required**); `volumes` (`object`, **required**); `databaseDumps` (`object[]`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#create-backup-policy).

### update_backup_policy

Replace a backup policy using its current settings version. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

**Arguments:** `projectId` (`string`, **required**); `name` (`string`, **required**); `environmentId` (`string`, **required**); `enabled` (`boolean`, **required**); `schedule` (`object`, **required**); `destination` (`object`, **required**); `retention` (`object`, **required**); `volumes` (`object`, **required**); `databaseDumps` (`object[]`, **required**); `policyId` (`string`, **required**); `settingsVersion` (`integer`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#update-backup-policy).

### delete_backup_policy

Remove a backup policy without deleting retained backup runs. Requires current administrator role.

**Permission:** `backups:write` · Owner/admin.

**Arguments:** `projectId` (`string`, **required**); `policyId` (`string`, **required**); `confirmation` (`string`, **required**, `"delete-policy"`); `settingsVersion` (`integer`, **required**); `idempotencyKey` (`string`, **required**).

[Full inputs and result](/docs/api-backups/#delete-backup-policy).

## Identity

### get_identity

Read the authenticated user, selected team, and effective credential scopes.

**Permission:** `projects:read` · Team member.

**Arguments:** .

[Full inputs and result](/docs/api-operations/#get-identity).
