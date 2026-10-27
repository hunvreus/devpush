import { withWorkspaceAccess } from '#devpush/server/plugins/workspace-access'
import {
  hostLifecycleCommandsChanged,
  hostLifecycleCommandsUseChangedSource,
  requireProjectRuntimeConfig,
} from '#devpush/lib/project-runtime-config'
import { PublicError } from '#devpush/lib/public-error'
import { prepareBackupPolicy } from '#devpush/server/backups/policy-validation'
import {
  queueBackupRestoreJob,
  queueEnvironmentBackup,
} from '#devpush/server/backups/service'
import {
  getOwnedBackupStorage,
  prepareBackupStorage,
} from '#devpush/server/backups/storage'
import {
  deleteBackupStorageState,
  saveBackupStorageState,
} from '#devpush/server/backups/storage-state'
import { db } from '#devpush/server/db'
import { isUniqueConstraintError } from '#devpush/server/db/errors'
import {
  agentJobs,
  apiAudit,
  apiIdempotency,
  backupConfigs,
  backupRuns,
  deployments,
  environments,
  projects,
  servers,
  teams,
  teamMembers,
} from '#devpush/server/db/schema'
import {
  deleteProjectBackupPolicyState,
  saveProjectBackupPolicyState,
} from '#devpush/server/projects/backup-policy-state'
import { updateProjectRuntimeState } from '#devpush/server/projects/configuration-state'
import { deleteProjectState } from '#devpush/server/projects/deletion-state'
import {
  createManualDeployment,
  createRedeployDeployment,
  createRollbackDeployment,
} from '#devpush/server/projects/deployments'
import {
  updateProjectEnvironments,
  updateProjectEnvironmentServers,
} from '#devpush/server/projects/environments'
import { normalizeProjectRoutes } from '#devpush/server/projects/mappers'
import {
  encryptProjectEnvVars,
  readProjectEnvVars,
} from '#devpush/server/projects/project-env-vars'
import { createProjectFromGitHub } from '#devpush/server/projects/repository'
import {
  notifyProject,
  notifyWorkspace,
} from '#devpush/server/realtime/service'
import {
  changeServerEnabled,
  deleteServerState,
} from '#devpush/server/servers/lifecycle'
import { getEffectiveServerStatus } from '#devpush/server/servers/status'
import type { SQL } from 'drizzle-orm'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { ApiMutationAdmission } from './admission'
import { apiAuthorizationCondition, requireApiScope } from './authorization'
import { apiFingerprint } from './cursors'
import { ApiError } from './errors'

import type { OperationContext } from './operation-context'
import {
  assertCurrentAuthorization,
  backupRow,
  deploymentRow,
  projectRow,
  requireWholeTeam,
  serialize,
  serverSelection,
} from './operation-context'

const API_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000
type Replay = { keyHash: string; requestHash: string; resourceId: string }
function replayIdentity(context: OperationContext, resourceId: string): Replay {
  const key = context.input.idempotencyKey
  if (typeof key !== 'string' || !key.trim())
    throw new ApiError('IDEMPOTENCY_REQUIRED', 400)
  const { idempotencyKey: _key, ...payload } = context.input
  return {
    keyHash: apiFingerprint(key),
    requestHash: apiFingerprint(payload),
    resourceId,
  }
}
async function readReplay(context: OperationContext, identity: Replay) {
  const [record] = await db
    .select({
      response: apiIdempotency.response,
      requestHash: apiIdempotency.requestHash,
    })
    .from(apiIdempotency)
    .where(
      and(
        eq(apiIdempotency.membershipId, context.principal.membershipId),
        eq(apiIdempotency.operation, context.operation.id),
        eq(apiIdempotency.resourceId, identity.resourceId),
        eq(apiIdempotency.keyHash, identity.keyHash),
      ),
    )
    .limit(1)
  if (!record) return null
  if (record.requestHash !== identity.requestHash)
    throw new ApiError('IDEMPOTENCY_CONFLICT', 409)
  await assertCurrentAuthorization(context)
  return context.operation.output.parse(record.response)
}
function admission(
  context: OperationContext,
  identity: Replay,
  resourceId: string,
  response: unknown,
  effectExists: SQL,
  secondaryResourceId?: string,
): ApiMutationAdmission {
  const now = Date.now()
  const { principal, operation } = context
  const safeResponse = operation.output.parse(response)
  const replayId = crypto.randomUUID()
  return {
    resourceId,
    secondaryResourceId,
    idempotencyId: replayId,
    guard: apiAuthorizationCondition(principal, {
      scope: operation.scope,
      projectId: context.input.projectId,
    }),
    statements: [
      db.run(sql`insert into ${apiIdempotency} (id,membership_id,credential_id,operation,resource_id,key_hash,request_hash,response,status_code,created_at,expires_at)
        select ${replayId},${principal.membershipId},${principal.credentialId},${operation.id},${identity.resourceId},${identity.keyHash},${identity.requestHash},${JSON.stringify(safeResponse)},${operation.status},${now},${now + API_IDEMPOTENCY_RETENTION_MS} where ${effectExists}`),
      db.run(sql`insert into ${apiAudit} (id,team_id,user_id,credential_id,request_id,operation,resource_id,outcome,created_at)
        select ${crypto.randomUUID()},${principal.teamId},${principal.userId},${principal.credentialId},${context.requestId},${operation.id},${resourceId},'accepted',${now} where exists(select 1 from ${apiIdempotency} where id = ${replayId})`),
    ],
  }
}
export async function mutateOperation(
  context: OperationContext,
): Promise<unknown> {
  const { operation, principal, input: i } = context
  let projectId: string | undefined = i.projectId
  let source: Awaited<ReturnType<typeof deploymentRow>> | undefined
  if (['redeploy', 'rollback'].includes(operation.id)) {
    source = await deploymentRow(context, i.deploymentId)
    projectId = source.projectId
  }
  if (operation.id === 'restore_backup')
    projectId = (await backupRow(context, i.backupRunId)).projectId
  if (projectId) i.projectId = projectId
  if (
    [
      'create_project',
      'rename_server',
      'create_server',
      'enable_server',
      'disable_server',
      'delete_server',
      'create_backup_storage',
      'update_backup_storage',
      'delete_backup_storage',
    ].includes(operation.id)
  )
    requireWholeTeam(principal)
  const identity = replayIdentity(
    context,
    i.deploymentId ??
      i.backupRunId ??
      i.policyId ??
      i.storageId ??
      i.projectId ??
      i.serverId ??
      principal.teamId,
  )
  const existing = await readReplay(context, identity)
  if (existing) return existing
  if (projectId) await projectRow(context, projectId)
  const apply = async () => {
    try {
      if (
        operation.id === 'update_environments' ||
        operation.id === 'update_environment_servers'
      ) {
        const { project, teamSlug } = await projectRow(context, projectId!)
        if (project.settingsVersion !== i.settingsVersion)
          throw new ApiError('SETTINGS_CONFLICT', 409)
        const now = new Date(
          Math.max(Date.now(), project.updatedAt.getTime() + 1),
        )
        const response = {
          projectId,
          settingsVersion: project.settingsVersion + 1,
        }
        const admitted = admission(
          context,
          identity,
          projectId!,
          response,
          sql`changes() = 1`,
        )
        const assignedServers =
          operation.id === 'update_environment_servers'
            ? [
                i.defaultServerId,
                ...i.environmentServers.map(
                  (assignment: OperationContext['input']) =>
                    assignment.serverId,
                ),
              ].filter(Boolean)
            : []
        admitted.guard = and(
          admitted.guard,
          sql`not exists(select 1 from json_each(${JSON.stringify(assignedServers)}) as assigned where not exists(select 1 from ${servers} where id = assigned.value and team_id = ${principal.teamId} and status <> 'deleted'))`,
        )!
        const base = {
          userId: principal.userId,
          teamSlug,
          projectName: project.name,
          admission: admitted,
          settingsVersion: project.settingsVersion,
          mutationTime: now,
        }
        if (operation.id === 'update_environments')
          await updateProjectEnvironments({
            ...base,
            projectEnvironments: i.environments,
          })
        else
          await updateProjectEnvironmentServers({
            ...base,
            defaultServerId: i.defaultServerId,
            environmentServers: i.environmentServers,
          })
        const recorded = await readReplay(context, identity)
        if (!recorded) throw new ApiError('OPERATION_CONFLICT', 409)
        await notifyProject(projectId!)
        return recorded
      }
      if (
        [
          'create_backup_policy',
          'update_backup_policy',
          'delete_backup_policy',
        ].includes(operation.id)
      ) {
        requireApiScope(principal, operation.scope, 'admin')
        await projectRow(context, projectId!)
        const [policy] = i.policyId
          ? await db
              .select()
              .from(backupConfigs)
              .where(
                and(
                  eq(backupConfigs.id, i.policyId),
                  eq(backupConfigs.projectId, projectId!),
                ),
              )
              .limit(1)
          : []
        if (i.policyId && !policy)
          throw new PublicError('BACKUP_POLICY_NOT_FOUND')
        if (policy && policy.settingsVersion !== i.settingsVersion)
          throw new ApiError('SETTINGS_CONFLICT', 409)
        const policyId = i.policyId ?? crypto.randomUUID()
        const now = Date.now()
        const response = {
          policyId,
          projectId,
          settingsVersion: policy ? policy.settingsVersion + 1 : 1,
        }
        const admitted = admission(
          context,
          identity,
          policyId,
          response,
          sql`changes() = 1`,
        )
        admitted.guard = apiAuthorizationCondition(principal, {
          scope: operation.scope,
          projectId,
          minimumRole: 'admin',
        })
        const base = {
          projectId: projectId!,
          teamId: principal.teamId,
          userId: principal.userId,
          settingsVersion:
            operation.id === 'create_backup_policy' ? null : i.settingsVersion,
          admission: admitted,
        }
        const changed =
          operation.id === 'delete_backup_policy'
            ? await deleteProjectBackupPolicyState(db, {
                ...base,
                policyId,
                settingsVersion: i.settingsVersion,
              })
            : await saveProjectBackupPolicyState(db, {
                ...base,
                policy: await prepareBackupPolicy({
                  teamId: principal.teamId,
                  projectId: projectId!,
                  policy: { ...i, id: policyId },
                }),
                now: new Date(now),
              })
        if (!changed) throw new ApiError('SETTINGS_CONFLICT', 409)
        await notifyProject(projectId!)
        return response
      }
      if (
        [
          'create_backup_storage',
          'update_backup_storage',
          'delete_backup_storage',
        ].includes(operation.id)
      ) {
        requireApiScope(principal, operation.scope, 'admin')
        const storageId = i.storageId ?? crypto.randomUUID()
        const prepared =
          operation.id === 'delete_backup_storage'
            ? null
            : await prepareBackupStorage({
                teamId: principal.teamId,
                input: { ...i, id: i.storageId },
                settingsVersion: i.settingsVersion,
                newStorageId: storageId,
              })
        const existingStorage =
          operation.id === 'delete_backup_storage'
            ? await getOwnedBackupStorage(principal.teamId, storageId)
            : null
        if (operation.id === 'delete_backup_storage') {
          if (!existingStorage)
            throw new PublicError('BACKUP_STORAGE_NOT_FOUND')
          if (existingStorage.settingsVersion !== i.settingsVersion)
            throw new PublicError('SETTINGS_CONFLICT')
        }
        const response = {
          storageId,
          settingsVersion: prepared
            ? (prepared.settingsVersion ?? 0) + 1
            : i.settingsVersion + 1,
        }
        const admitted = admission(
          context,
          identity,
          storageId,
          response,
          sql`changes() = 1`,
        )
        admitted.guard = apiAuthorizationCondition(principal, {
          scope: operation.scope,
          minimumRole: 'admin',
        })
        const base = {
          teamId: principal.teamId,
          userId: principal.userId,
          storageId,
          admission: admitted,
        }
        const changed =
          operation.id === 'delete_backup_storage'
            ? await deleteBackupStorageState(db, {
                ...base,
                settingsVersion: i.settingsVersion,
              })
            : await saveBackupStorageState(db, {
                ...base,
                settingsVersion: prepared!.settingsVersion,
                values: prepared!.values,
                now: new Date(),
              })
        if (!changed)
          throw new PublicError(
            operation.id === 'delete_backup_storage'
              ? 'BACKUP_STORAGE_IN_USE'
              : prepared!.settingsVersion === null
                ? 'FORBIDDEN'
                : 'SETTINGS_CONFLICT',
          )
        return response
      }
      if (operation.id === 'create_project') {
        if (i.envVars?.length) requireApiScope(principal, 'secrets:write')
        const createdProjectId = crypto.randomUUID()
        const response = {
          projectId: createdProjectId,
          statusUrl: `/api/v1/projects/${createdProjectId}`,
        }
        const admitted = admission(
          context,
          identity,
          createdProjectId,
          response,
          sql`exists(select 1 from ${projects} where id = ${createdProjectId})`,
        )
        if (i.envVars?.length)
          admitted.guard = and(
            admitted.guard,
            apiAuthorizationCondition(principal, { scope: 'secrets:write' }),
          )!
        const [team] = await db
          .select({ slug: teams.slug })
          .from(teams)
          .where(eq(teams.id, principal.teamId))
          .limit(1)
        if (!team) throw new ApiError('NOT_FOUND', 404)
        await createProjectFromGitHub({
          ...i,
          userId: principal.userId,
          teamSlug: team.slug,
          projectName: i.projectName,
          repoFullName: i.repoFullName,
          installationId: i.installationId,
          serverId: i.serverId ?? null,
          admission: admitted,
        })
        const recorded = await readReplay(context, identity)
        if (!recorded) throw new ApiError('OPERATION_CONFLICT', 409)
        await notifyWorkspace(principal.teamId, 'deployments')
        return recorded
      }
      if (operation.id === 'delete_project') {
        const { project } = await projectRow(context, projectId!)
        requireApiScope(principal, operation.scope, 'admin')
        if (project.name !== i.confirmationName)
          throw new PublicError('PROJECT_DELETE_CONFIRMATION')
        const response = { projectId, status: 'deleted' }
        const admitted = admission(
          context,
          identity,
          projectId!,
          response,
          sql`changes() = 1`,
        )
        admitted.guard = apiAuthorizationCondition(principal, {
          scope: operation.scope,
          projectId,
          minimumRole: 'admin',
        })
        const changed = await deleteProjectState(db, {
          projectId: projectId!,
          teamId: principal.teamId,
          userId: principal.userId,
          removeDeployments: i.removeDeployments,
          now: new Date(),
          admission: admitted,
        })
        if (!changed) throw new ApiError('OPERATION_CONFLICT', 409)
        await notifyWorkspace(principal.teamId, 'deployments')
        return response
      }
      if (
        ['enable_server', 'disable_server', 'delete_server'].includes(
          operation.id,
        )
      ) {
        const [server] = await db
          .select({ id: servers.id, name: servers.name })
          .from(servers)
          .where(
            and(
              eq(servers.id, i.serverId),
              eq(servers.teamId, principal.teamId),
              ne(servers.status, 'deleted'),
            ),
          )
          .limit(1)
        if (!server) throw new ApiError('NOT_FOUND', 404)
        if (
          operation.id !== 'enable_server' &&
          i.confirmationName !== server.name
        )
          throw new PublicError(
            operation.id === 'disable_server'
              ? 'SERVER_DISABLE_CONFIRMATION'
              : 'SERVER_DELETE_CONFIRMATION',
          )
        const response =
          operation.id === 'delete_server'
            ? { serverId: server.id, status: 'deleted' }
            : { serverId: server.id, enabled: operation.id === 'enable_server' }
        const admitted = admission(
          context,
          identity,
          server.id,
          response,
          sql`changes() = 1`,
        )
        const base = {
          userId: principal.userId,
          teamId: principal.teamId,
          serverId: server.id,
          now: new Date(),
          admission: admitted,
        }
        const changed =
          operation.id === 'delete_server'
            ? await withWorkspaceAccess(
                principal.teamId,
                'server.delete',
                () =>
                  deleteServerState(db, {
                    ...base,
                    cancelOngoingDeployments: i.cancelOngoingDeployments,
                  }),
                {
                  kind: 'user',
                  userId: principal.userId,
                  roleCeiling: principal.roleCeiling,
                },
              )
            : await changeServerEnabled(db, {
                ...base,
                enabled: operation.id === 'enable_server',
              })
        if (!changed) throw new ApiError('OPERATION_CONFLICT', 409)
        await notifyWorkspace(principal.teamId, 'servers')
        return response
      }
      if (operation.id === 'update_project_configuration') {
        const { project } = await projectRow(context, projectId!)
        if (project.settingsVersion !== i.settingsVersion)
          throw new ApiError('SETTINGS_CONFLICT', 409)
        const previous = requireProjectRuntimeConfig(project.runtimeConfig)
        const changedHostCommands =
          hostLifecycleCommandsChanged(previous, i.runtimeConfig) ||
          hostLifecycleCommandsUseChangedSource({
            currentRepoFullName: project.githubRepo,
            nextRepoFullName: project.githubRepo,
            currentRuntimeConfig: previous,
            nextRuntimeConfig: i.runtimeConfig,
          })
        if (changedHostCommands)
          requireApiScope(principal, 'projects:host-commands', 'admin')
        const envIds = [
          ...new Set(
            i.routes
              .map((route: OperationContext['input']) => route.environmentId)
              .filter(Boolean),
          ),
        ]
        const available = await db
          .select({ id: environments.id })
          .from(environments)
          .where(
            and(
              eq(environments.projectId, projectId!),
              eq(environments.status, 'active'),
            ),
          )
          .limit(1001)
        if (envIds.some((id) => !available.some((row) => row.id === id)))
          throw new PublicError('PROJECT_ROUTE_ENVIRONMENT_INVALID')
        const now = new Date(
          Math.max(Date.now(), project.updatedAt.getTime() + 1),
        )
        const response = {
          projectId,
          settingsVersion: project.settingsVersion + 1,
        }
        const admitted = admission(
          context,
          identity,
          projectId!,
          response,
          sql`changes() = 1`,
        )
        const hostGuard = changedHostCommands
          ? apiAuthorizationCondition(principal, {
              scope: 'projects:host-commands',
              projectId,
              minimumRole: 'admin',
            })
          : sql`1`
        admitted.guard = and(admitted.guard, hostGuard)!
        const changed = await updateProjectRuntimeState(db, {
          projectId: projectId!,
          userId: principal.userId,
          settingsVersion: project.settingsVersion,
          currentRuntimeConfig: project.runtimeConfig,
          runtimeConfig: i.runtimeConfig,
          routes: normalizeProjectRoutes(i.routes),
          now,
          admission: admitted,
        })
        if (!changed) throw new ApiError('SETTINGS_CONFLICT', 409)
        await notifyProject(projectId!)
        return response
      }
      if (['deploy', 'redeploy', 'rollback'].includes(operation.id)) {
        const { project, teamSlug } = await projectRow(context, projectId!)
        const deploymentId = crypto.randomUUID()
        const response = {
          deploymentId,
          statusUrl: `/api/v1/deployments/${deploymentId}`,
        }
        const admitted = admission(
          context,
          identity,
          deploymentId,
          response,
          sql`exists(select 1 from ${deployments} where id = ${deploymentId})`,
        )
        if (operation.id === 'deploy')
          await createManualDeployment({
            userId: principal.userId,
            teamSlug,
            projectName: project.name,
            environmentId: i.environmentId,
            gitBranch: i.branch,
            gitSha: i.sha,
            admission: admitted,
          })
        else
          await (
            operation.id === 'rollback'
              ? createRollbackDeployment
              : createRedeployDeployment
          )({
            userId: principal.userId,
            teamSlug,
            projectName: project.name,
            deploymentId: source!.deployment.id,
            admission: admitted,
          })
        const recorded = await readReplay(context, identity)
        if (!recorded) throw new ApiError('OPERATION_CONFLICT', 409)
        return recorded
      }
      if (operation.id === 'run_backup') {
        const backupRunId = crypto.randomUUID()
        const agentJobId = crypto.randomUUID()
        const response = {
          backupRunId,
          agentJobId,
          statusUrl: `/api/v1/backups/${backupRunId}`,
        }
        const admitted = admission(
          context,
          identity,
          backupRunId,
          response,
          sql`exists(select 1 from ${backupRuns} where id = ${backupRunId})`,
          agentJobId,
        )
        const queued = await queueEnvironmentBackup({
          actor: {
            kind: 'user',
            userId: principal.userId,
            roleCeiling: principal.roleCeiling,
          },
          projectId: projectId!,
          environmentId: i.environmentId,
          backupConfigId: i.policyId,
          admission: admitted,
        })
        if (!queued) throw new ApiError('OPERATION_CONFLICT', 409)
        await notifyProject(projectId!)
        return response
      }
      if (operation.id === 'restore_backup') {
        const agentJobId = crypto.randomUUID()
        const response = { agentJobId, statusUrl: `/api/v1/jobs/${agentJobId}` }
        const admitted = admission(
          context,
          identity,
          agentJobId,
          response,
          sql`exists(select 1 from ${agentJobs} where id = ${agentJobId})`,
        )
        await queueBackupRestoreJob({
          actor: {
            kind: 'user',
            userId: principal.userId,
            roleCeiling: principal.roleCeiling,
          },
          projectId: projectId!,
          backupRunId: i.backupRunId,
          artifacts: i.artifacts,
          admission: admitted,
        })
        await notifyProject(projectId!)
        const recorded = await readReplay(context, identity)
        if (!recorded) throw new ApiError('OPERATION_CONFLICT', 409)
        return recorded
      }
      if (
        operation.id === 'rename_project' ||
        operation.id === 'update_variables'
      ) {
        const { project } = await projectRow(context, projectId!)
        if (project.settingsVersion !== i.settingsVersion)
          throw new ApiError('SETTINGS_CONFLICT', 409)
        const now = new Date(
          Math.max(Date.now(), project.updatedAt.getTime() + 1),
        )
        let ciphertext = project.envVarsEncrypted
        if (operation.id === 'update_variables') {
          const rows = readProjectEnvVars(project)
          const seen = new Set<string>()
          const environmentIds = [
            ...new Set(
              i.changes
                .map(
                  (change: OperationContext['input']) => change.environmentId,
                )
                .filter(Boolean),
            ),
          ]
          const valid = await db
            .select({ id: environments.id })
            .from(environments)
            .where(
              and(
                eq(environments.projectId, projectId!),
                eq(environments.status, 'active'),
              ),
            )
            .limit(1001)
          if (environmentIds.some((id) => !valid.some((row) => row.id === id)))
            throw new PublicError('PROJECT_VARIABLE_ENVIRONMENT_INVALID')
          for (const change of i.changes) {
            const key = `${change.environmentId ?? ''}\0${change.key}`
            if (seen.has(key))
              throw new PublicError('PROJECT_VARIABLE_DUPLICATED')
            seen.add(key)
            const index = rows.findIndex(
              (row) =>
                (row.environment || null) === change.environmentId &&
                row.key === change.key,
            )
            if (index >= 0) rows.splice(index, 1)
            if (change.value !== null)
              rows.push({
                key: change.key,
                environment: change.environmentId ?? undefined,
                value: change.value,
              })
          }
          ciphertext = encryptProjectEnvVars(rows)
        }
        const response =
          operation.id === 'rename_project'
            ? serialize({
                id: project.id,
                teamId: project.teamId,
                name: i.name,
                slug: i.name,
                repository: project.githubRepo,
                repositoryId: project.githubRepoId,
                defaultServerId: project.defaultServerId,
                settingsVersion: project.settingsVersion + 1,
                createdAt: project.createdAt,
              })
            : { projectId, settingsVersion: project.settingsVersion + 1 }
        const effect = sql`changes() = 1`
        const admitted = admission(
          context,
          identity,
          projectId!,
          response,
          effect,
        )
        const [changed] = await db.batch([
          db.all(
            sql`update ${projects} set settings_version = settings_version + 1,updated_at = ${now.getTime()}, ${operation.id === 'rename_project' ? sql`name = ${i.name}, slug = ${i.name}` : sql`env_vars_encrypted = ${ciphertext}`} where id = ${projectId} and status = 'active' and settings_version = ${project.settingsVersion} and env_vars_encrypted is ${project.envVarsEncrypted} and ${admitted.guard} returning id`,
          ),
          ...admitted.statements,
        ])
        if (!changed.length) throw new ApiError('SETTINGS_CONFLICT', 409)
        await notifyProject(projectId!)
        return response
      }
      if (
        operation.id === 'rename_server' ||
        operation.id === 'create_server'
      ) {
        const now = new Date()
        const serverId = i.serverId ?? crypto.randomUUID()
        const [existingServer] = i.serverId
          ? await db
              .select(serverSelection)
              .from(servers)
              .where(
                and(
                  eq(servers.id, i.serverId),
                  eq(servers.teamId, principal.teamId),
                  ne(servers.status, 'deleted'),
                ),
              )
              .limit(1)
          : []
        if (i.serverId && !existingServer) throw new ApiError('NOT_FOUND', 404)
        if (
          existingServer &&
          existingServer.settingsVersion !== i.settingsVersion
        )
          throw new ApiError('SETTINGS_CONFLICT', 409)
        const response = existingServer
          ? serialize({
              ...existingServer,
              settingsVersion: existingServer.settingsVersion + 1,
              name: i.name,
              status: getEffectiveServerStatus(existingServer),
            })
          : {
              settingsVersion: 1,
              id: serverId,
              teamId: principal.teamId,
              name: i.name,
              status: 'pending',
              publicAddress: null,
              agentVersion: null,
              lastSeenAt: null,
              createdAt: now.toISOString(),
            }
        const effect = sql`changes() = 1`
        const admitted = admission(
          context,
          identity,
          serverId,
          response,
          effect,
        )
        if (operation.id === 'create_server') {
          const [member] = await db
            .select({ role: teamMembers.role })
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.id, principal.membershipId),
                eq(teamMembers.userId, principal.userId),
                eq(teamMembers.teamId, principal.teamId),
              ),
            )
            .limit(1)
          if (!member) throw new PublicError('FORBIDDEN')
          admitted.guard = sql`${admitted.guard} and exists(select 1 from team_members where id=${principal.membershipId} and role=${member.role})`
        }
        const write = () =>
          db.batch([
            operation.id === 'rename_server'
              ? db.all(
                  sql`update ${servers} set settings_version = settings_version + 1,name = ${i.name}, handle = ${i.name}, updated_at = ${now.getTime()} where id = ${serverId} and settings_version = ${i.settingsVersion} and team_id = ${principal.teamId} and status <> 'deleted' and ${admitted.guard} returning id`,
                )
              : db.all(
                  sql`insert into ${servers} (id,team_id,name,handle,status,created_at,updated_at) select ${serverId},${principal.teamId},${i.name},${i.name},'pending',${now.getTime()},${now.getTime()} where ${admitted.guard} returning id`,
                ),
            ...(operation.id === 'create_server'
              ? [
                  db.run(
                    sql`insert into server_availability_windows (id,server_id,started_at) select ${crypto.randomUUID()},${serverId},${now.getTime()} where changes()=1`,
                  ),
                ]
              : []),
            ...admitted.statements,
          ])
        const [changed] =
          operation.id === 'create_server'
            ? await withWorkspaceAccess(
                principal.teamId,
                'server.create',
                write,
                {
                  kind: 'user',
                  userId: principal.userId,
                  roleCeiling: principal.roleCeiling,
                },
              )
            : await write()
        if (!changed.length) throw new PublicError('FORBIDDEN')
        await notifyWorkspace(principal.teamId, 'servers')
        return response
      }
    } catch (error) {
      // A duplicate idempotency insert rolls back every preceding effect and
      // cancellation in the same batch. Replays never queue a second job.
      const replay = await readReplay(context, identity)
      if (replay) return replay
      if (isUniqueConstraintError(error)) {
        if (operation.id === 'rename_project')
          throw new PublicError('PROJECT_NAME_CONFLICT')
        throw new ApiError('OPERATION_CONFLICT', 409)
      }
      throw error
    }
    throw new ApiError('NOT_FOUND', 404)
  }
  if (!operation.workspacePolicy) throw new Error('Mutation policy is missing.')
  return operation.workspacePolicy.boundary === 'dispatcher'
    ? withWorkspaceAccess(
        principal.teamId,
        operation.workspacePolicy.operation,
        apply,
        {
          kind: 'user',
          userId: principal.userId,
          roleCeiling: principal.roleCeiling,
        },
      )
    : apply()
}
