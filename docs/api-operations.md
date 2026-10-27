---
description: Supported REST endpoints, required scopes and MCP availability.
---

# Public API operations

See [API and assistants](/docs/api/) for authentication and retries. Your installation's `/api/v1/openapi.json` provides request/response schemas. The table is checked against the implemented catalog.

Scopes do not override team roles. “Administrator” means a team owner/admin; unrestricted access excludes project-restricted credentials. REST writes require `Idempotency-Key`; MCP uses `idempotencyKey` and the tool's confirmation fields.

| Endpoint | Required scope | MCP tool | Behavior |
| --- | --- | --- | --- |
| `GET /api/v1/backup-storage` | `backups:read` | Yes | List team storage destination metadata without access keys. Unavailable to project-restricted credentials. |
| `POST /api/v1/backup-storage` | `backups:write` | No | Create a team backup destination. Secret access keys are write-only. Requires current administrator role. |
| `DELETE /api/v1/backup-storage/{storageId}` | `backups:write` | No | Delete an unreferenced backup destination. Policies, active backups, and retained remote artifacts prevent deletion. |
| `PUT /api/v1/backup-storage/{storageId}` | `backups:write` | No | Rename or rotate credentials of a team backup destination. Bucket, region, and endpoint are immutable. |
| `GET /api/v1/backups/{backupRunId}` | `backups:read` | Yes | Read backup status by immutable backup run ID. |
| `GET /api/v1/backups/{backupRunId}/artifacts` | `backups:read` | Yes | List restore artifact identifiers, types, sizes, and checksums. Object keys and credentials are excluded. |
| `POST /api/v1/backups/{backupRunId}/restore` | `backups:restore` | Yes | Queue a destructive restore into the current environment. Requires administrator role and explicit confirmation. |
| `GET /api/v1/deployments/{deploymentId}` | `deployments:read` | Yes | Read deployment status by immutable deployment ID. |
| `GET /api/v1/deployments/{deploymentId}/logs` | `logs:read` | Yes | Read bounded build or control log entries. Application output may contain secrets. |
| `POST /api/v1/deployments/{deploymentId}/redeploy` | `deployments:write` | Yes | Queue the recorded commit and runtime settings with current routing. |
| `POST /api/v1/deployments/{deploymentId}/rollback` | `deployments:write` | Yes | Queue a successful recorded commit and runtime settings with current routing. |
| `GET /api/v1/github/installations` | `projects:write` | No | List one provider page of linked GitHub installations available when creating projects. Requires unrestricted team management access. |
| `GET /api/v1/github/repositories` | `projects:write` | No | List one provider page of repositories with push access in a linked installation. Continue with nextCursor even when a filtered page is empty. |
| `GET /api/v1/identity` | `projects:read` | Yes | Read the authenticated user, selected team, and effective credential scopes. |
| `GET /api/v1/jobs/{jobId}` | `backups:read` | Yes | Read an asynchronous backup or restore job status without its credential-bearing payload. |
| `GET /api/v1/jobs/{jobId}/logs` | `logs:read` | Yes | Read bounded backup or restore output. Logs may contain application secrets. |
| `GET /api/v1/projects` | `projects:read` | Yes | List authorized active projects using a bounded cursor. |
| `POST /api/v1/projects` | `projects:write` | Yes | Create a Compose project from a repository accessible to the owner’s linked GitHub account. Browser GitHub connection and installation consent must already be complete. |
| `GET /api/v1/projects/{projectId}` | `projects:read` | Yes | Read public project metadata. Secret values and private configuration snapshots are excluded. |
| `PATCH /api/v1/projects/{projectId}` | `projects:write` | Yes | Rename a project using its current settings version. Resource IDs stay unchanged. |
| `DELETE /api/v1/projects/{projectId}` | `projects:write` | Yes | Delete a project and optionally queue deployed runtime removal. Requires current administrator role and the project name as confirmation. |
| `GET /api/v1/projects/{projectId}/aliases` | `projects:read` | Yes | List generated deployment, branch, and environment aliases. |
| `GET /api/v1/projects/{projectId}/backup-policies` | `backups:read` | Yes | List policy identifiers and enabled state. Database connection secrets are excluded. |
| `POST /api/v1/projects/{projectId}/backup-policies` | `backups:write` | Yes | Create a backup policy. Requires current administrator role. |
| `GET /api/v1/projects/{projectId}/backup-policies/{policyId}` | `backups:read` | Yes | Read a backup policy without commands or storage credentials. |
| `DELETE /api/v1/projects/{projectId}/backup-policies/{policyId}` | `backups:write` | Yes | Remove a backup policy without deleting retained backup runs. Requires current administrator role. |
| `PUT /api/v1/projects/{projectId}/backup-policies/{policyId}` | `backups:write` | Yes | Replace a backup policy using its current settings version. Requires current administrator role. |
| `GET /api/v1/projects/{projectId}/backups` | `backups:read` | Yes | List backup status metadata. Storage credentials and internal manifests are excluded. |
| `POST /api/v1/projects/{projectId}/backups` | `backups:write` | Yes | Queue a manual run of an enabled backup policy. |
| `GET /api/v1/projects/{projectId}/configuration` | `projects:read` | Yes | Read the supported Compose runtime configuration and routes. |
| `PUT /api/v1/projects/{projectId}/configuration` | `projects:write` | Yes | Replace Compose runtime configuration and routes with settings version protection. Host lifecycle command changes require their separate administrator scope. |
| `GET /api/v1/projects/{projectId}/deploy-options` | `deployments:read` | Yes | List one provider page of matching branches and recent commits only for the selected branch. Continue with nextCursor to reach later matching branches, including after empty filtered pages. |
| `GET /api/v1/projects/{projectId}/deployments` | `deployments:read` | Yes | List deployment metadata. Build snapshots and variable values are excluded. |
| `POST /api/v1/projects/{projectId}/deployments` | `deployments:write` | Yes | Queue a deployment from a matching GitHub branch. Requires a unique idempotencyKey; returns acceptance, not execution success. |
| `GET /api/v1/projects/{projectId}/domains` | `projects:read` | Yes | List custom domains and their verification status. |
| `PUT /api/v1/projects/{projectId}/environment-servers` | `projects:write` | Yes | Update default and per-environment server assignments, regenerating environment aliases. Unspecified environment assignments are preserved. |
| `GET /api/v1/projects/{projectId}/environments` | `projects:read` | Yes | List the active environments for a project. |
| `PUT /api/v1/projects/{projectId}/environments` | `projects:write` | Yes | Replace environment definitions with project settings version protection. Omitted server assignments are preserved. Production is required. |
| `GET /api/v1/projects/{projectId}/runtime-logs` | `logs:read` | Yes | Read bounded runtime output from current environment server assignments. Application output may contain secrets. |
| `GET /api/v1/projects/{projectId}/variables` | `projects:read` | Yes | List variable names and environment scopes. Values are never returned. |
| `PATCH /api/v1/projects/{projectId}/variables` | `secrets:write` | Yes | Patch write-only variables. Omitted values are preserved; deleted names are removed only in their chosen environment scope. |
| `GET /api/v1/servers` | `servers:read` | Yes | List team server metadata. Unavailable to project-restricted credentials. |
| `POST /api/v1/servers` | `servers:write` | No | Create a pending server. Enrollment credentials are generated separately in the browser. |
| `GET /api/v1/servers/{serverId}` | `servers:read` | Yes | Read server metadata. Enrollment and agent credentials are excluded. |
| `PATCH /api/v1/servers/{serverId}` | `servers:write` | No | Rename a server. Requires current team administrator role. |
| `DELETE /api/v1/servers/{serverId}` | `servers:write` | No | Delete a server using its name as confirmation. Existing deployment cancellation is an explicit option. |
| `GET /api/v1/servers/{serverId}/delete-diagnostic` | `servers:write` | No | Read counts of active project and environment assignments affected by server deletion. |
| `POST /api/v1/servers/{serverId}/disable` | `servers:write` | No | Disable a server using its name as confirmation. Requires current administrator role. |
| `POST /api/v1/servers/{serverId}/enable` | `servers:write` | No | Enable a disabled server. Requires current administrator role. |
| `GET /api/v1/servers/{serverId}/metrics` | `servers:read` | Yes | Read bounded host metric samples. |

Personal-account changes, installation administration, team membership/invitations/ownership, avatar uploads, custom-domain creation and verification, repository settings and enrollment credential issuance remain browser workflows in this version. They are not exposed through this API or MCP. The host-agent protocol remains separate.
