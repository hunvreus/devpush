import type { WorkspaceOperation } from '#devpush/plugins/operations'
import { settingsVersionSchema } from '#devpush/lib/settings-version'
import { projectEnvironmentsSchema } from '#devpush/lib/project-environments-schema'
import { storedBackupDatabaseSchema } from '#devpush/lib/backup-database'
import { z } from 'zod'
import type { TeamRole } from '#devpush/lib/team-role'
import {
  publicBackupAcceptedSchema,
  publicBackupInputSchema,
  publicBackupRunSchema,
  publicDeploymentAcceptedSchema,
  publicDeploymentInputSchema,
  publicDeploymentSchema,
  publicEnvironmentSchema,
  publicErrorResponseSchema,
  publicIdSchema,
  publicLogPageSchema,
  publicPageInputSchema,
  publicPageSchema,
  publicProjectInputSchema,
  publicProjectSchema,
  publicRestoreAcceptedSchema,
  publicServerInputSchema,
  publicServerSchema,
  publicTimestampSchema,
} from '#devpush/lib/public-api-schema'
import { backupRestoreArtifactSchema } from '#devpush/lib/backup-restore-schema'
import { projectRoutesSchema } from '#devpush/lib/project-routing-schema'
import { createProjectSchema } from '#devpush/lib/project-creation-schema'
import { backupConfigSchema } from '#devpush/lib/backup-policy-schema'
import { backupStorageSchema } from '#devpush/lib/backup-storage-schema'
import { projectMachineNameSchema } from '#devpush/lib/project-settings-schema'
import { serverNameSchema } from '#devpush/lib/server-name-schema'
import { projectRuntimeConfigSchema } from '#devpush/lib/project-runtime-config'

export type PublicApiOperation = {
  id: string
  description: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  scope: string
  input: z.ZodObject
  output: z.ZodType
  status: number
  mcp: boolean
  destructive: boolean
  workspacePolicy: {
    operation: WorkspaceOperation
    boundary: 'domain' | 'dispatcher'
  } | null
  readOnly: boolean
  requiresWholeTeam: boolean
  minimumRole: TeamRole
}
function operation(
  input: Omit<
    PublicApiOperation,
    | 'status'
    | 'mcp'
    | 'destructive'
    | 'readOnly'
    | 'requiresWholeTeam'
    | 'minimumRole'
    | 'workspacePolicy'
    | 'method'
  > &
    (
      | { method: 'GET'; workspacePolicy?: never }
      | {
          method: Exclude<PublicApiOperation['method'], 'GET'>
          workspacePolicy: NonNullable<PublicApiOperation['workspacePolicy']>
        }
    ) &
    Partial<
      Pick<
        PublicApiOperation,
        'status' | 'mcp' | 'destructive' | 'requiresWholeTeam' | 'minimumRole'
      >
    >,
) {
  return {
    workspacePolicy: null,
    status: 200,
    mcp: true,
    destructive: false,
    requiresWholeTeam: [
      'list_servers',
      'get_server',
      'read_server_metrics',
      'list_backup_storage',
      'create_project',
      'rename_server',
      'create_server',
      'enable_server',
      'disable_server',
      'delete_server',
      'get_server_delete_diagnostic',
      'create_backup_storage',
      'update_backup_storage',
      'delete_backup_storage',
    ].includes(input.id),
    minimumRole:
      input.id === 'delete_project' ? ('admin' as const) : ('member' as const),
    ...input,
    readOnly: input.method === 'GET',
  }
}
const projectPage = publicProjectInputSchema.extend(publicPageInputSchema.shape)
const deploymentPage = projectPage.extend({
  environmentId: publicIdSchema.optional(),
})
const logPage = publicPageInputSchema.extend({
  stream: z.enum(['build', 'control']).default('build'),
})
const runtimeLogInput = projectPage.extend({
  environmentId: publicIdSchema.optional(),
  service: z.string().min(1).max(128).optional(),
  keyword: z.string().min(1).max(200).optional(),
  since: publicTimestampSchema.optional(),
})
export const publicApiOperations: PublicApiOperation[] = [
  operation({
    id: 'list_github_installations',
    description:
      'List one provider page of linked GitHub installations available when creating projects. Requires unrestricted team management access.',
    method: 'GET',
    path: '/github/installations',
    scope: 'projects:write',
    requiresWholeTeam: true,
    mcp: false,
    input: publicPageInputSchema,
    output: publicPageSchema(
      z.strictObject({
        id: z.number().int(),
        accountLogin: z.string(),
        accountType: z.string(),
        repositorySelection: z.string(),
      }),
    ),
  }),
  operation({
    id: 'list_github_repositories',
    description:
      'List one provider page of repositories with push access in a linked installation. Continue with nextCursor even when a filtered page is empty.',
    method: 'GET',
    path: '/github/repositories',
    scope: 'projects:write',
    requiresWholeTeam: true,
    mcp: false,
    input: publicPageInputSchema.extend({
      installationId: z.coerce.number().int().positive(),
    }),
    output: publicPageSchema(
      z.strictObject({
        id: z.number().int(),
        installationId: z.number().int(),
        fullName: z.string(),
        defaultBranch: z.string(),
        private: z.boolean(),
      }),
    ),
  }),
  operation({
    id: 'get_backup_policy',
    description:
      'Read a backup policy without legacy commands or storage credentials.',
    method: 'GET',
    path: '/projects/{projectId}/backup-policies/{policyId}',
    scope: 'backups:read',
    input: publicProjectInputSchema.extend({ policyId: publicIdSchema }),
    output: backupConfigSchema
      .extend({
        id: publicIdSchema,
        projectId: publicIdSchema,
        settingsVersion: settingsVersionSchema,
        databaseDumps: z
          .array(storedBackupDatabaseSchema.omit({ legacyCommand: true }))
          .max(100),
      })
      .strict(),
  }),
  operation({
    id: 'get_identity',
    description:
      'Read the authenticated user, selected team, and effective credential scopes.',
    method: 'GET',
    path: '/identity',
    scope: 'projects:read',
    input: z.strictObject({}),
    output: z.strictObject({
      user: z.strictObject({
        id: publicIdSchema,
        name: z.string(),
        username: z.string(),
      }),
      team: z.strictObject({
        id: publicIdSchema,
        name: z.string(),
        slug: z.string(),
      }),
      scopes: z.array(z.string()),
      projectIds: z.array(publicIdSchema).nullable(),
    }),
  }),
  operation({
    id: 'list_projects',
    description: 'List authorized active projects using a bounded cursor.',
    method: 'GET',
    path: '/projects',
    scope: 'projects:read',
    input: publicPageInputSchema,
    output: publicPageSchema(publicProjectSchema),
  }),
  operation({
    id: 'get_project',
    description:
      'Read public project metadata. Secret values and private configuration snapshots are excluded.',
    method: 'GET',
    path: '/projects/{projectId}',
    scope: 'projects:read',
    input: publicProjectInputSchema,
    output: publicProjectSchema,
  }),
  operation({
    id: 'list_environments',
    description: 'List the active environments for a project.',
    method: 'GET',
    path: '/projects/{projectId}/environments',
    scope: 'projects:read',
    input: projectPage,
    output: publicPageSchema(publicEnvironmentSchema),
  }),
  operation({
    id: 'get_project_configuration',
    description: 'Read the supported Compose runtime configuration and routes.',
    method: 'GET',
    path: '/projects/{projectId}/configuration',
    scope: 'projects:read',
    input: publicProjectInputSchema,
    output: z.strictObject({
      settingsVersion: settingsVersionSchema,
      runtimeConfig: projectRuntimeConfigSchema,
      routes: projectRoutesSchema.shape.routes,
    }),
  }),
  operation({
    id: 'list_variables',
    description:
      'List variable names and environment scopes. Values are never returned.',
    method: 'GET',
    path: '/projects/{projectId}/variables',
    scope: 'projects:read',
    input: projectPage,
    output: publicPageSchema(
      z.strictObject({
        key: z.string(),
        environmentId: publicIdSchema.nullable(),
      }),
    ).extend({ settingsVersion: settingsVersionSchema }),
  }),
  operation({
    id: 'list_domains',
    description: 'List custom domains and their verification status.',
    method: 'GET',
    path: '/projects/{projectId}/domains',
    scope: 'projects:read',
    input: projectPage,
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        environmentId: publicIdSchema,
        hostname: z.string().nullable(),
        basePath: z.string().nullable(),
        https: z.boolean(),
        status: z.string(),
        createdAt: publicTimestampSchema,
      }),
    ),
  }),
  operation({
    id: 'list_aliases',
    description: 'List generated deployment, branch, and environment aliases.',
    method: 'GET',
    path: '/projects/{projectId}/aliases',
    scope: 'projects:read',
    input: projectPage,
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        environmentId: publicIdSchema,
        deploymentId: publicIdSchema.nullable(),
        hostname: z.string().nullable(),
        type: z.enum(['deployment', 'environment', 'branch']),
        branch: z.string().nullable(),
        https: z.boolean(),
        createdAt: publicTimestampSchema,
      }),
    ),
  }),
  operation({
    id: 'list_deployments',
    description:
      'List deployment metadata. Build snapshots and variable values are excluded.',
    method: 'GET',
    path: '/projects/{projectId}/deployments',
    scope: 'deployments:read',
    input: deploymentPage,
    output: publicPageSchema(publicDeploymentSchema),
  }),
  operation({
    id: 'get_deployment',
    description: 'Read deployment status by immutable deployment ID.',
    method: 'GET',
    path: '/deployments/{deploymentId}',
    scope: 'deployments:read',
    input: publicDeploymentInputSchema,
    output: publicDeploymentSchema,
  }),
  operation({
    id: 'read_deployment_logs',
    description:
      'Read bounded build or control log entries. Application output may contain secrets.',
    method: 'GET',
    path: '/deployments/{deploymentId}/logs',
    scope: 'logs:read',
    input: publicDeploymentInputSchema.extend(logPage.shape),
    output: publicLogPageSchema,
  }),
  operation({
    id: 'read_runtime_logs',
    description:
      'Read bounded runtime output from current environment server assignments. Application output may contain secrets.',
    method: 'GET',
    path: '/projects/{projectId}/runtime-logs',
    scope: 'logs:read',
    input: runtimeLogInput,
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        environmentId: publicIdSchema,
        service: z.string(),
        content: z.string().max(64 * 1024),
        observedAt: publicTimestampSchema,
        truncated: z.boolean(),
      }),
    ).extend({ retentionMayHaveRemovedEarlierEntries: z.literal(true) }),
  }),
  operation({
    id: 'list_servers',
    description:
      'List team server metadata. Unavailable to project-restricted credentials.',
    method: 'GET',
    path: '/servers',
    scope: 'servers:read',
    input: publicPageInputSchema,
    output: publicPageSchema(publicServerSchema),
  }),
  operation({
    id: 'get_server',
    description:
      'Read server metadata. Enrollment and agent credentials are excluded.',
    method: 'GET',
    path: '/servers/{serverId}',
    scope: 'servers:read',
    input: publicServerInputSchema,
    output: publicServerSchema,
  }),
  operation({
    id: 'read_server_metrics',
    description: 'Read bounded host metric samples.',
    method: 'GET',
    path: '/servers/{serverId}/metrics',
    scope: 'servers:read',
    input: publicServerInputSchema
      .extend(publicPageInputSchema.shape)
      .extend({ since: publicTimestampSchema.optional() }),
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        observedAt: publicTimestampSchema,
        cpuPercent: z.number().nullable(),
        memoryUsedBytes: z.number().nullable(),
        memoryTotalBytes: z.number().nullable(),
        diskUsedBytes: z.number().nullable(),
        diskTotalBytes: z.number().nullable(),
        networkReceiveBytesPerSecond: z.number().nullable(),
        networkTransmitBytesPerSecond: z.number().nullable(),
      }),
    ),
  }),
  operation({
    id: 'list_backups',
    description:
      'List backup status metadata. Storage credentials and internal manifests are excluded.',
    method: 'GET',
    path: '/projects/{projectId}/backups',
    scope: 'backups:read',
    input: deploymentPage,
    output: publicPageSchema(publicBackupRunSchema),
  }),
  operation({
    id: 'get_backup',
    description: 'Read backup status by immutable backup run ID.',
    method: 'GET',
    path: '/backups/{backupRunId}',
    scope: 'backups:read',
    input: publicBackupInputSchema,
    output: publicBackupRunSchema,
  }),
  operation({
    id: 'list_backup_artifacts',
    description:
      'List restore artifact identifiers, types, sizes, and checksums. Object keys and credentials are excluded.',
    method: 'GET',
    path: '/backups/{backupRunId}/artifacts',
    scope: 'backups:read',
    input: publicBackupInputSchema.extend(publicPageInputSchema.shape),
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        type: z.enum(['manifest', 'volume', 'database']),
        storage: z.enum(['local', 'remote']),
        sizeBytes: z.number().nonnegative(),
        checksumSha256: z.string(),
        createdAt: publicTimestampSchema,
      }),
    ),
  }),
  operation({
    id: 'list_backup_policies',
    description:
      'List policy identifiers and enabled state. Database connection secrets are excluded.',
    method: 'GET',
    path: '/projects/{projectId}/backup-policies',
    scope: 'backups:read',
    input: projectPage,
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        name: z.string(),
        environmentId: publicIdSchema,
        enabled: z.boolean(),
        createdAt: publicTimestampSchema,
      }),
    ),
  }),
  operation({
    id: 'list_backup_storage',
    description:
      'List team storage destination metadata without access keys. Unavailable to project-restricted credentials.',
    method: 'GET',
    path: '/backup-storage',
    scope: 'backups:read',
    input: publicPageInputSchema,
    output: publicPageSchema(
      z.strictObject({
        id: publicIdSchema,
        settingsVersion: settingsVersionSchema,
        name: z.string(),
        bucket: z.string(),
        region: z.string(),
        endpoint: z.string().nullable(),
        createdAt: publicTimestampSchema,
      }),
    ),
  }),
  operation({
    id: 'get_job',
    description:
      'Read an asynchronous backup or restore job status without its credential-bearing payload.',
    method: 'GET',
    path: '/jobs/{jobId}',
    scope: 'backups:read',
    input: z.strictObject({ jobId: publicIdSchema }),
    output: z.strictObject({
      id: publicIdSchema,
      projectId: publicIdSchema,
      type: z.string(),
      status: z.string(),
      createdAt: publicTimestampSchema,
      finishedAt: publicTimestampSchema.nullable(),
    }),
  }),
  operation({
    id: 'read_job_logs',
    description:
      'Read bounded backup or restore output. Logs may contain application secrets.',
    method: 'GET',
    path: '/jobs/{jobId}/logs',
    scope: 'logs:read',
    input: z
      .strictObject({ jobId: publicIdSchema })
      .extend(publicPageInputSchema.shape),
    output: publicLogPageSchema,
  }),
  operation({
    id: 'deploy',
    workspacePolicy: { operation: 'deployment.create', boundary: 'domain' },
    description:
      'Queue a deployment from a matching GitHub branch. Requires a unique idempotencyKey; returns acceptance, not execution success.',
    method: 'POST',
    path: '/projects/{projectId}/deployments',
    scope: 'deployments:write',
    status: 202,
    input: publicProjectInputSchema.extend({
      environmentId: publicIdSchema,
      branch: z.string().min(1).max(255),
      sha: z
        .string()
        .regex(/^[a-f0-9]{40}$/i)
        .optional(),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicDeploymentAcceptedSchema,
  }),
  operation({
    id: 'redeploy',
    workspacePolicy: { operation: 'deployment.create', boundary: 'domain' },
    description:
      'Queue the recorded commit and runtime settings with current routing.',
    method: 'POST',
    path: '/deployments/{deploymentId}/redeploy',
    scope: 'deployments:write',
    status: 202,
    input: publicDeploymentInputSchema.extend({
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicDeploymentAcceptedSchema,
  }),
  operation({
    id: 'rollback',
    workspacePolicy: { operation: 'deployment.create', boundary: 'domain' },
    description:
      'Queue a successful recorded commit and runtime settings with current routing.',
    method: 'POST',
    path: '/deployments/{deploymentId}/rollback',
    scope: 'deployments:write',
    status: 202,
    destructive: true,
    input: publicDeploymentInputSchema.extend({
      confirmation: z.literal('rollback'),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicDeploymentAcceptedSchema,
  }),
  operation({
    id: 'run_backup',
    workspacePolicy: { operation: 'backup.run', boundary: 'domain' },
    description: 'Queue a manual run of an enabled backup policy.',
    method: 'POST',
    path: '/projects/{projectId}/backups',
    scope: 'backups:write',
    status: 202,
    input: publicProjectInputSchema.extend({
      environmentId: publicIdSchema,
      policyId: publicIdSchema
        .optional()
        .describe(
          'Required when the environment has multiple enabled policies.',
        ),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicBackupAcceptedSchema,
  }),
  operation({
    id: 'restore_backup',
    workspacePolicy: { operation: 'backup.restore', boundary: 'domain' },
    description:
      'Queue a destructive restore into the current environment. Requires administrator role and explicit confirmation.',
    method: 'POST',
    path: '/backups/{backupRunId}/restore',
    scope: 'backups:restore',
    status: 202,
    destructive: true,
    input: publicBackupInputSchema.extend({
      confirmation: z.literal('restore'),
      artifacts: z.array(backupRestoreArtifactSchema).min(1).max(100),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicRestoreAcceptedSchema,
  }),
  operation({
    id: 'rename_project',
    workspacePolicy: { operation: 'project.update', boundary: 'dispatcher' },
    description:
      'Rename a project using its current settings version. Resource IDs stay unchanged.',
    method: 'PATCH',
    path: '/projects/{projectId}',
    scope: 'projects:write',
    input: publicProjectInputSchema.extend({
      name: projectMachineNameSchema,
      settingsVersion: settingsVersionSchema,
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicProjectSchema,
  }),
  operation({
    id: 'update_variables',
    workspacePolicy: { operation: 'variable.update', boundary: 'dispatcher' },
    description:
      'Patch write-only variables. Omitted values are preserved; deleted names are removed only in their chosen environment scope.',
    method: 'PATCH',
    path: '/projects/{projectId}/variables',
    scope: 'secrets:write',
    input: publicProjectInputSchema.extend({
      settingsVersion: settingsVersionSchema,
      changes: z
        .array(
          z.strictObject({
            key: z
              .string()
              .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
              .max(255),
            environmentId: publicIdSchema.nullable(),
            value: z
              .string()
              .max(64 * 1024)
              .nullable(),
          }),
        )
        .min(1)
        .max(100),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'rename_server',
    workspacePolicy: { operation: 'server.update', boundary: 'dispatcher' },
    description: 'Rename a server. Requires current team administrator role.',
    method: 'PATCH',
    path: '/servers/{serverId}',
    scope: 'servers:write',
    mcp: false,
    input: publicServerInputSchema.extend({
      settingsVersion: settingsVersionSchema,
      name: serverNameSchema,
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicServerSchema,
  }),
  operation({
    id: 'create_server',
    workspacePolicy: { operation: 'server.create', boundary: 'domain' },
    description:
      'Create a pending server. Enrollment credentials are generated separately in the browser.',
    method: 'POST',
    path: '/servers',
    scope: 'servers:write',
    mcp: false,
    status: 201,
    input: z.strictObject({
      name: serverNameSchema,
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: publicServerSchema,
  }),
  operation({
    id: 'update_project_configuration',
    workspacePolicy: { operation: 'project.update', boundary: 'dispatcher' },
    description:
      'Replace Compose runtime configuration and routes with settings version protection. Host lifecycle command changes require their separate administrator scope.',
    method: 'PUT',
    path: '/projects/{projectId}/configuration',
    scope: 'projects:write',
    input: publicProjectInputSchema.extend({
      settingsVersion: settingsVersionSchema,
      runtimeConfig: projectRuntimeConfigSchema,
      routes: projectRoutesSchema.shape.routes.max(100),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'delete_project',
    workspacePolicy: { operation: 'project.delete', boundary: 'dispatcher' },
    description:
      'Delete a project and optionally queue deployed runtime removal. Requires current administrator role and the project name as confirmation.',
    method: 'DELETE',
    path: '/projects/{projectId}',
    scope: 'projects:write',
    destructive: true,
    input: publicProjectInputSchema.extend({
      confirmationName: z.string().min(1).max(100),
      removeDeployments: z.boolean().default(true),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      projectId: publicIdSchema,
      status: z.literal('deleted'),
    }),
  }),
  operation({
    id: 'enable_server',
    workspacePolicy: { operation: 'server.enable', boundary: 'dispatcher' },
    description:
      'Enable a disabled server. Requires current administrator role.',
    method: 'POST',
    path: '/servers/{serverId}/enable',
    scope: 'servers:write',
    mcp: false,
    input: publicServerInputSchema.extend({
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      serverId: publicIdSchema,
      enabled: z.literal(true),
    }),
  }),
  operation({
    id: 'disable_server',
    workspacePolicy: { operation: 'server.disable', boundary: 'dispatcher' },
    description:
      'Disable a server using its name as confirmation. Requires current administrator role.',
    method: 'POST',
    path: '/servers/{serverId}/disable',
    scope: 'servers:write',
    mcp: false,
    destructive: true,
    input: publicServerInputSchema.extend({
      confirmationName: z.string().min(1).max(100),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      serverId: publicIdSchema,
      enabled: z.literal(false),
    }),
  }),
  operation({
    id: 'delete_server',
    workspacePolicy: { operation: 'server.delete', boundary: 'domain' },
    description:
      'Delete a server using its name as confirmation. Existing deployment cancellation is an explicit option.',
    method: 'DELETE',
    path: '/servers/{serverId}',
    scope: 'servers:write',
    mcp: false,
    destructive: true,
    input: publicServerInputSchema.extend({
      confirmationName: z.string().min(1).max(100),
      cancelOngoingDeployments: z.boolean().default(true),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      serverId: publicIdSchema,
      status: z.literal('deleted'),
    }),
  }),
  operation({
    id: 'get_server_delete_diagnostic',
    description:
      'Read counts of active project and environment assignments affected by server deletion.',
    method: 'GET',
    path: '/servers/{serverId}/delete-diagnostic',
    scope: 'servers:write',
    mcp: false,
    input: publicServerInputSchema,
    output: z.strictObject({
      serverId: publicIdSchema,
      projectCount: z.number().int().nonnegative(),
      environmentCount: z.number().int().nonnegative(),
    }),
  }),
  operation({
    id: 'create_project',
    workspacePolicy: { operation: 'project.create', boundary: 'domain' },
    description:
      'Create a Compose project from a repository accessible to the owner’s linked GitHub account. Browser GitHub connection and installation consent must already be complete.',
    method: 'POST',
    path: '/projects',
    scope: 'projects:write',
    status: 201,
    input: createProjectSchema
      .omit({ teamSlug: true })
      .extend({
        envVars: createProjectSchema.shape.envVars.unwrap().max(100).optional(),
        idempotencyKey: z.string().min(1).max(128),
      })
      .strict(),
    output: z.strictObject({
      projectId: publicIdSchema,
      statusUrl: z.string(),
    }),
  }),
  operation({
    id: 'get_deployment_options',
    description:
      'List one provider page of matching branches and recent commits only for the selected branch. Continue with nextCursor to reach later matching branches, including after empty filtered pages.',
    method: 'GET',
    path: '/projects/{projectId}/deploy-options',
    scope: 'deployments:read',
    input: projectPage.extend({
      environmentId: publicIdSchema,
      branch: z.string().min(1).max(255).optional(),
    }),
    output: z.strictObject({
      branches: z.array(z.string()).max(100),
      nextCursor: z.string().nullable(),
      selectedBranch: z.string().nullable(),
      commits: z
        .array(
          z.strictObject({
            sha: z.string(),
            message: z.string().nullable(),
            url: z.string().nullable(),
            authorName: z.string().nullable(),
            authoredAt: publicTimestampSchema.nullable(),
          }),
        )
        .max(5),
    }),
  }),
  operation({
    id: 'create_backup_policy',
    workspacePolicy: {
      operation: 'backup.policy.save',
      boundary: 'dispatcher',
    },
    description: 'Create a backup policy. Requires current administrator role.',
    method: 'POST',
    path: '/projects/{projectId}/backup-policies',
    scope: 'backups:write',
    status: 201,
    input: publicProjectInputSchema
      .extend(backupConfigSchema.omit({ id: true }).shape)
      .extend({
        idempotencyKey: z.string().min(1).max(128),
      }),
    output: z.strictObject({
      policyId: publicIdSchema,
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'update_backup_policy',
    workspacePolicy: {
      operation: 'backup.policy.save',
      boundary: 'dispatcher',
    },
    description:
      'Replace a backup policy using its current settings version. Requires current administrator role.',
    method: 'PUT',
    path: '/projects/{projectId}/backup-policies/{policyId}',
    scope: 'backups:write',
    input: publicProjectInputSchema
      .extend(backupConfigSchema.omit({ id: true }).shape)
      .extend({
        policyId: publicIdSchema,
        settingsVersion: settingsVersionSchema,
        idempotencyKey: z.string().min(1).max(128),
      }),
    output: z.strictObject({
      policyId: publicIdSchema,
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'delete_backup_policy',
    workspacePolicy: {
      operation: 'backup.policy.delete',
      boundary: 'dispatcher',
    },
    description:
      'Remove a backup policy without deleting retained backup runs. Requires current administrator role.',
    method: 'DELETE',
    path: '/projects/{projectId}/backup-policies/{policyId}',
    scope: 'backups:write',
    destructive: true,
    input: publicProjectInputSchema.extend({
      policyId: publicIdSchema,
      confirmation: z.literal('delete-policy'),
      settingsVersion: settingsVersionSchema,
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      policyId: publicIdSchema,
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'create_backup_storage',
    workspacePolicy: {
      operation: 'backup.storage.save',
      boundary: 'dispatcher',
    },
    description:
      'Create a team backup destination. Secret access keys are write-only. Requires current administrator role.',
    method: 'POST',
    path: '/backup-storage',
    scope: 'backups:write',
    mcp: false,
    status: 201,
    input: backupStorageSchema
      .omit({ id: true })
      .extend({ idempotencyKey: z.string().min(1).max(128) })
      .strict(),
    output: z.strictObject({
      storageId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'update_backup_storage',
    workspacePolicy: {
      operation: 'backup.storage.save',
      boundary: 'dispatcher',
    },
    description:
      'Rename or rotate credentials of a team backup destination. Bucket, region, and endpoint are immutable.',
    method: 'PUT',
    path: '/backup-storage/{storageId}',
    scope: 'backups:write',
    mcp: false,
    input: backupStorageSchema
      .omit({ id: true })
      .extend({
        storageId: publicIdSchema,
        settingsVersion: settingsVersionSchema,
        idempotencyKey: z.string().min(1).max(128),
      })
      .strict(),
    output: z.strictObject({
      storageId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'delete_backup_storage',
    workspacePolicy: {
      operation: 'backup.storage.delete',
      boundary: 'dispatcher',
    },
    description:
      'Delete an unreferenced backup destination. Policies, active backups, and retained remote artifacts prevent deletion.',
    method: 'DELETE',
    path: '/backup-storage/{storageId}',
    scope: 'backups:write',
    mcp: false,
    destructive: true,
    input: z.strictObject({
      storageId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
      confirmation: z.literal('delete-storage'),
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      storageId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'update_environments',
    workspacePolicy: { operation: 'environment.update', boundary: 'domain' },
    description:
      'Replace environment definitions with project settings version protection. Omitted server assignments are preserved. Production is required.',
    method: 'PUT',
    path: '/projects/{projectId}/environments',
    scope: 'projects:write',
    destructive: true,
    input: publicProjectInputSchema.extend({
      environments: projectEnvironmentsSchema.shape.environments.max(100),
      settingsVersion: settingsVersionSchema,
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
  operation({
    id: 'update_environment_servers',
    workspacePolicy: { operation: 'environment.update', boundary: 'domain' },
    description:
      'Update default and per-environment server assignments, regenerating environment aliases. Unspecified environment assignments are preserved.',
    method: 'PUT',
    path: '/projects/{projectId}/environment-servers',
    scope: 'projects:write',
    input: publicProjectInputSchema.extend({
      defaultServerId: publicIdSchema.nullable(),
      environmentServers: z
        .array(
          z.strictObject({
            environmentId: publicIdSchema,
            serverId: publicIdSchema.nullable(),
          }),
        )
        .max(100),
      settingsVersion: settingsVersionSchema,
      idempotencyKey: z.string().min(1).max(128),
    }),
    output: z.strictObject({
      projectId: publicIdSchema,
      settingsVersion: settingsVersionSchema,
    }),
  }),
]

export function findPublicApiOperation(id: string) {
  return publicApiOperations.find((entry) => entry.id === id)
}

// Generated from the very schemas used before execution and before responding.
// Unknown input properties are rejected; output schemas reject private fields.
export function createPublicOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const entry of publicApiOperations) {
    const parameters = Object.entries(entry.input.shape).flatMap(
      ([name, schema]) => {
        const path = entry.path.includes(`{${name}}`)
        if (!path && entry.method !== 'GET') return []
        return [
          {
            name,
            in: path ? 'path' : 'query',
            required: path || !schema.isOptional(),
            schema: z.toJSONSchema(schema, { io: 'input' }),
          },
        ]
      },
    )
    const bodyShape = Object.fromEntries(
      Object.entries(entry.input.shape).filter(
        ([name]) =>
          !entry.path.includes(`{${name}}`) && name !== 'idempotencyKey',
      ),
    )
    const pathItem = (paths[`/api/v1${entry.path}`] ??= {})
    pathItem[entry.method.toLowerCase()] = {
      operationId: entry.id,
      description: entry.description,
      security: [{ apiKey: [] }],
      parameters: entry.readOnly
        ? parameters
        : [
            ...parameters,
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 128 },
            },
          ],
      ...(entry.readOnly || Object.keys(bodyShape).length === 0
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: z.toJSONSchema(z.strictObject(bodyShape), {
                    io: 'input',
                  }),
                },
              },
            },
          }),
      responses: Object.fromEntries(
        [entry.status, 400, 401, 403, 404, 409, 422, 429, 500].map((status) => [
          status,
          {
            description: status === entry.status ? 'Success' : 'Public error',
            content: {
              'application/json': {
                schema: z.toJSONSchema(
                  status === entry.status
                    ? entry.output
                    : publicErrorResponseSchema,
                  { io: 'output' },
                ),
              },
            },
          },
        ]),
      ),
      'x-devpush-scope': entry.scope,
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'devpush management API', version: '1.0.0' },
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'A scoped devpush API key created in Account settings.',
        },
      },
    },
  }
}
