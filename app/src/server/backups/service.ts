import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import {
  withWorkspaceAccess,
  isWorkspacePolicyRefusal,
} from '#devpush/server/plugins/workspace-access'
import type { WorkspaceActor } from '#devpush/plugins/operations'
import { teamSettingsAccess } from '#devpush/server/settings-version'
import { backupDestinationSnapshot } from './destination'
import { requireBackupsEnabled } from '#devpush/server/backups/feature'
import { backupRestoreArtifactSchema as restoreArtifactSchema } from '#devpush/lib/backup-restore-schema'
import type { backupVolumesSchema } from '#devpush/lib/backup-policy-schema'
import {
  normalizeBackupVolumes,
  backupRetentionSchema,
  backupScheduleSchema,
} from '#devpush/lib/backup-policy-schema'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import { PublicError } from '#devpush/lib/public-error'
import {
  backupDatabaseSchema,
  storedBackupDatabaseSchema,
  databaseArtifactTarget,
} from '#devpush/lib/backup-database'
import type { BackupDatabase } from '#devpush/lib/backup-database'
import {
  buildDatabaseBackupCommand,
  buildDatabaseRestoreCommand,
} from './database-commands'
import { backupStorageReferenceSchema } from '#devpush/lib/backup-storage-schema'
import { resolveBackupDestination, refreshBackupCredentials } from './storage'
import {
  enqueueBackup,
  enqueueBackupCleanup,
  backupCleanupRetryDelayMs,
} from './queue-state'
import { randomUUID } from 'node:crypto'

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#devpush/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  environments,
  projects,
  servers,
} from '#devpush/server/db/schema'
import { isCronDue } from '#devpush/lib/backup-cron'

const s3DestinationSchema = z.object({
  storageId: z.string().optional(),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(
      /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
      'S3 bucket names must use lowercase DNS-compatible characters.',
    ),
  region: z.string().trim().min(1).max(100).optional(),
  endpoint: z.string().trim().url().optional(),
  prefix: z.string().trim().max(512).optional(),
  accessKeyId: z.string().trim().min(1).max(256).optional(),
  secretAccessKeyCiphertext: z.string().trim().min(1).optional(),
  secretAccessKeyPreview: z.string().trim().min(1).max(64).optional(),
})

const databaseDumpSchema = backupDatabaseSchema

export type BackupDestination = z.infer<typeof s3DestinationSchema>
type BackupRetentionLimit = z.infer<typeof backupRetentionSchema>['local']
export type BackupRetentionPolicy = z.infer<typeof backupRetentionSchema>
export type BackupDatabaseDump = BackupDatabase
export type BackupVolumeSelection = z.infer<typeof backupVolumesSchema>
export type BackupRestoreArtifactInput = z.infer<typeof restoreArtifactSchema>

export type BackupJobPayload = {
  schemaVersion: 1
  backupRunId: string
  artifactPrefix: string
  localBasePath: string
  projectId: string
  environmentId: string
  runtimeId: string
  destination: BackupDestination & {
    secretAccessKey?: string
  }
  retention: BackupRetentionPolicy
  volumes: BackupVolumeSelection
  databaseDumps: Array<{ service: string; command: string; format: string }>
}

export type BackupCleanupJobPayload = {
  schemaVersion: 1
  backupRunIds: Array<string>
  destination?: BackupDestination
  localObjectKeys: Array<string>
  remoteObjectKeys: Array<string>
  reason: string
}

export type BackupRestoreJobPayload = {
  schemaVersion: 1
  backupRunId: string
  projectId: string
  environmentId: string
  runtimeId: string
  destination?: BackupDestination & {
    secretAccessKey?: string
  }
  artifacts: Array<
    | {
        id: string
        type: 'volume'
        storage: 'local' | 'remote'
        objectKey: string
        checksumSha256: string
        targetVolume: string
      }
    | {
        id: string
        type: 'database'
        storage: 'local' | 'remote'
        objectKey: string
        checksumSha256: string
        targetService: string
        restoreCommand: string
      }
  >
}

export async function queueEnvironmentBackup({
  projectId,
  environmentId,
  deploymentId,
  manifest,
  scheduleKey,
  backupConfigId,
  admission,
  actor,
}: {
  projectId: string
  environmentId: string
  deploymentId?: string | null
  manifest?: unknown
  scheduleKey?: string
  backupConfigId?: string
  admission?: ApiMutationAdmission
  actor: WorkspaceActor
}) {
  requireBackupsEnabled()
  const rows = await db
    .select({
      config: backupConfigs,
      serverCapabilities: servers.agentCapabilities,
      environment: environments,
      project: projects,
    })
    .from(backupConfigs)
    .innerJoin(environments, eq(environments.id, backupConfigs.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .innerJoin(
      servers,
      eq(
        servers.id,
        sql<string>`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.status, 'active'),
        eq(environments.id, environmentId),
        eq(environments.status, 'active'),
        eq(backupConfigs.enabled, true),
        backupConfigId ? eq(backupConfigs.id, backupConfigId) : undefined,
        inArray(servers.status, ['connected', 'disconnected']),
      ),
    )
    .limit(2)
  if (!backupConfigId && rows.length > 1) {
    throw new PublicError('BACKUP_POLICY_REQUIRED')
  }
  const row = rows.at(0)

  if (!row) {
    throw new PublicError('BACKUP_ENABLED_CONFIG_NOT_FOUND')
  }
  return withWorkspaceAccess(
    row.project.teamId,
    'backup.run',
    async () => {
      admission = {
        ...admission,
        resourceId: admission?.resourceId ?? randomUUID(),
        statements: admission?.statements ?? [],
        guard: sql`${admission?.guard ?? sql`1`} and ${actor.kind === 'user' ? teamSettingsAccess(row.project.teamId, actor.userId) : sql`1`}`,
      }

      const serverId = row.environment.serverId ?? row.project.defaultServerId

      if (!serverId) {
        throw new PublicError('BACKUP_SERVER_REQUIRED')
      }
      const reference = backupStorageReferenceSchema.parse(
        row.config.destination,
      )
      const retention = backupRetentionSchema.parse(row.config.retention)
      const destination = retention.remote.enabled
        ? normalizeS3Destination(
            await resolveBackupDestination(row.project.teamId, reference),
          )
        : { bucket: 'local-backups', prefix: reference.prefix }
      const volumes = normalizeBackupVolumes(row.config.volumes)
      const databaseDumps = z
        .array(databaseDumpSchema)
        .parse(row.config.databaseDumps)
      if (
        databaseDumps.some((target) => target.engine === 'mongo') &&
        !(row.serverCapabilities ?? []).includes('jobs.backup.archive.v1')
      ) {
        throw new PublicError('BACKUP_MONGODB_AGENT_UPDATE_REQUIRED')
      }
      const now = new Date()
      const backupRunId = admission.resourceId
      const agentJobId = admission.secondaryResourceId ?? randomUUID()
      const artifactPrefix = buildBackupArtifactPrefix({
        destination,
        projectId,
        environmentId,
        backupRunId,
      })
      const localBasePath = buildBackupLocalBasePath({
        projectId,
        environmentId,
        backupRunId,
      })

      const payload = {
        schemaVersion: 1,
        backupRunId,
        artifactPrefix,
        localBasePath,
        projectId,
        environmentId,
        runtimeId: row.environment.runtimeId,
        destination: buildBackupJobDestination({ destination, retention }),
        retention,
        volumes,
        databaseDumps: databaseDumps.map((target) => ({
          service: target.service,
          command: buildDatabaseBackupCommand(target),
          format: target.engine === 'mongo' ? 'archive' : 'sql',
        })),
      } satisfies BackupJobPayload

      const created = await enqueueBackup(db, {
        backupRunId,
        agentJobId,
        configId: row.config.id,
        projectId,
        environmentId,
        deploymentId: deploymentId ?? null,
        serverId,
        runtimeId: row.environment.runtimeId,
        scheduleKey: scheduleKey ?? null,
        manifest: {
          ...(typeof manifest === 'object' && manifest !== null
            ? manifest
            : {}),
          databaseTargets: databaseDumps,
        },
        payload,
        now,
        admission,
      })

      if (!created) {
        return null
      }

      return {
        backupRunId,
        agentJobId,
        payload,
      }
    },
    actor,
  )
}

function buildBackupJobDestination({
  destination,
  retention,
}: {
  destination: BackupDestination
  retention: BackupRetentionPolicy
}): BackupJobPayload['destination'] {
  if (!retention.remote.enabled) {
    return backupDestinationSnapshot(destination)
  }

  if (!destination.accessKeyId || !destination.secretAccessKeyCiphertext) {
    throw new PublicError('BACKUP_CREDENTIALS_MISSING')
  }

  return {
    ...backupDestinationSnapshot(destination),
  }
}

export async function queueBackupRestoreJob({
  projectId,
  backupRunId,
  artifacts,
  admission,
  actor,
}: {
  projectId: string
  backupRunId: string
  artifacts: Array<BackupRestoreArtifactInput>
  admission?: ApiMutationAdmission
  actor: WorkspaceActor
}) {
  requireBackupsEnabled()
  const requestedArtifacts = artifacts.map((artifact) =>
    restoreArtifactSchema.parse(artifact),
  )

  if (requestedArtifacts.length === 0) {
    throw new PublicError('BACKUP_RESTORE_ARTIFACT_REQUIRED')
  }

  const runRows = await db
    .select({
      run: backupRuns,
      environment: environments,
      config: backupConfigs,
      project: projects,
    })
    .from(backupRuns)
    .innerJoin(environments, eq(environments.id, backupRuns.environmentId))
    .innerJoin(projects, eq(projects.id, backupRuns.projectId))
    .leftJoin(
      backupConfigs,
      and(
        eq(backupConfigs.projectId, backupRuns.projectId),
        eq(backupConfigs.environmentId, backupRuns.environmentId),
      ),
    )
    .where(
      and(eq(backupRuns.id, backupRunId), eq(backupRuns.projectId, projectId)),
    )
    .limit(1)
  const row = runRows.at(0)

  if (!row) {
    throw new PublicError('BACKUP_RUN_NOT_FOUND')
  }
  return withWorkspaceAccess(
    row.project.teamId,
    'backup.restore',
    async () => {
      admission = {
        ...admission,
        resourceId: admission?.resourceId ?? randomUUID(),
        statements: admission?.statements ?? [],
        guard: sql`${admission?.guard ?? sql`1`} and ${actor.kind === 'user' ? teamSettingsAccess(row.project.teamId, actor.userId) : sql`1`}`,
      }

      const localRecovery =
        row.run.status === 'failed' &&
        row.run.manifest !== null &&
        typeof row.run.manifest === 'object' &&
        'localRecoveryAvailable' in row.run.manifest &&
        row.run.manifest.localRecoveryAvailable === true
      if (row.run.status !== 'succeeded' && !localRecovery) {
        throw new PublicError('BACKUP_NO_RECOVERABLE_ARTIFACTS')
      }

      const effectiveServerId =
        row.environment.serverId ?? row.project.defaultServerId

      if (!row.run.serverId || row.run.serverId !== effectiveServerId) {
        throw new PublicError('BACKUP_SERVER_CHANGED')
      }

      const artifactRows = await db
        .select()
        .from(backupArtifacts)
        .where(
          and(
            eq(backupArtifacts.backupRunId, backupRunId),
            sql`${backupArtifacts.id} in (select value from json_each(${JSON.stringify(requestedArtifacts.map((artifact) => artifact.artifactId))}))`,
          ),
        )

      if (
        localRecovery &&
        artifactRows.some((artifact) => artifact.storage !== 'local')
      )
        throw new PublicError('BACKUP_FAILED_REMOTE_RESTORE')

      if (artifactRows.length !== requestedArtifacts.length) {
        throw new PublicError('BACKUP_ARTIFACT_NOT_FOUND')
      }

      const requestedByArtifactId = new Map(
        requestedArtifacts.map((artifact) => [artifact.artifactId, artifact]),
      )
      const restoreArtifacts: BackupRestoreJobPayload['artifacts'] = []
      let needsRemoteDestination = false

      for (const artifact of artifactRows) {
        const requested = requestedByArtifactId.get(artifact.id)

        if (!requested) {
          continue
        }

        if (artifact.type !== requested.type) {
          throw new PublicError('BACKUP_ARTIFACT_TYPE_MISMATCH')
        }

        if (artifact.storage === 'remote') {
          needsRemoteDestination = true
        }

        if (requested.type === 'volume') {
          restoreArtifacts.push({
            id: artifact.id,
            type: 'volume',
            storage: artifact.storage,
            objectKey: artifact.objectKey,
            checksumSha256: artifact.checksumSha256,
            targetVolume: requested.targetVolume,
          })
        } else {
          restoreArtifacts.push({
            id: artifact.id,
            type: 'database',
            storage: artifact.storage,
            objectKey: artifact.objectKey,
            checksumSha256: artifact.checksumSha256,
            targetService: requested.targetService,
            restoreCommand: buildDatabaseRestoreCommand(
              requireDatabaseArtifactTarget(
                artifact.objectKey,
                row.run.manifest,
              ),
            ),
          })
        }
      }

      const snapshot = row.run.destination
        ? s3DestinationSchema.parse(row.run.destination)
        : null
      const destination =
        needsRemoteDestination && snapshot
          ? buildRestoreJobDestination(
              await refreshBackupCredentials(row.project.teamId, snapshot),
            )
          : undefined
      if (needsRemoteDestination && !destination)
        throw new PublicError('BACKUP_DESTINATION_UNAVAILABLE')

      const now = new Date()
      const jobId = admission.resourceId
      const payload = {
        schemaVersion: 1,
        backupRunId,
        projectId,
        environmentId: row.run.environmentId,
        runtimeId: row.run.runtimeId,
        destination,
        artifacts: restoreArtifacts,
      } satisfies BackupRestoreJobPayload

      const [inserted] = await db.batch([
        db.all(sql`insert into ${agentJobs}
      (id,type,status,server_id,team_id,project_id,payload,max_attempts,available_at,created_at,updated_at)
      select ${jobId},'restore','queued',${row.run.serverId},null,${projectId},${JSON.stringify(payload)},1,${now.getTime()},${now.getTime()},${now.getTime()}
      where exists(select 1 from ${agentJobs} where id = ${jobId}) or (
        ${admission.guard}
        and exists(select 1 from ${backupRuns} as run
          join ${environments} as env on env.id = run.environment_id
          join ${projects} as project on project.id = env.project_id
          join ${servers} as server on server.id = coalesce(env.server_id,project.default_server_id)
          where run.id = ${backupRunId} and run.project_id = ${projectId}
            and project.status = 'active' and env.status = 'active'
            and server.id = run.server_id and server.status in ('connected','disconnected')
            and run.status = ${row.run.status})
        and not exists(select 1 from ${agentJobs} where type = 'restore'
          and status in ('queued','running') and project_id = ${projectId}
          and json_extract(payload,'$.runtimeId') = ${row.run.runtimeId})
      ) returning id`),
        ...admission.statements,
      ])
      if (inserted.length !== 1) throw new PublicError('BACKUP_ALREADY_ACTIVE')

      return {
        agentJobId: jobId,
        payload,
      }
    },
    actor,
  )
}

function buildRestoreJobDestination(
  destination: BackupDestination,
): BackupRestoreJobPayload['destination'] {
  if (!destination.accessKeyId || !destination.secretAccessKeyCiphertext) {
    throw new PublicError('BACKUP_RESTORE_CREDENTIALS_MISSING')
  }

  return {
    ...backupDestinationSnapshot(destination),
  }
}

export async function queueBackupRetentionCleanupJobs({
  projectId,
  environmentId,
  now = new Date(),
}: {
  projectId?: string
  environmentId?: string
  now?: Date
} = {}) {
  const configRows = await db
    .select()
    .from(backupConfigs)
    .where(
      projectId && environmentId
        ? and(
            eq(backupConfigs.projectId, projectId),
            eq(backupConfigs.environmentId, environmentId),
          )
        : projectId
          ? eq(backupConfigs.projectId, projectId)
          : environmentId
            ? eq(backupConfigs.environmentId, environmentId)
            : undefined,
    )

  if (configRows.length === 0) {
    return []
  }

  const queuedJobs: Array<{ id: string; backupRunIds: Array<string> }> = []

  for (const config of configRows) {
    const parsedRetention = backupRetentionSchema.safeParse(config.retention)
    if (!parsedRetention.success) {
      console.error('Skipping backup retention policy with invalid settings.', {
        policyId: config.id,
      })
      continue
    }
    const retention = parsedRetention.data

    const runRows = await db
      .select()
      .from(backupRuns)
      .where(
        and(
          sql`exists(select 1 from projects where id = ${backupRuns.projectId} and status = 'active')`,
          sql`(${backupRuns.cleanupErrorMessage} is null or ${backupRuns.updatedAt} <= ${now.getTime() - backupCleanupRetryDelayMs})`,
          sql`exists(select 1 from servers where id = ${backupRuns.serverId} and status <> 'deleted')`,
          eq(backupRuns.environmentId, config.environmentId),
          sql`(${backupRuns.configId} = ${config.id} or (${backupRuns.configId} is null and (select count(*) from ${backupConfigs} where environment_id = ${config.environmentId}) = 1))`,
          sql`(${backupRuns.status} = 'succeeded' or (${backupRuns.status} = 'failed' and json_extract(${backupRuns.manifest}, '$.localRecoveryAvailable') = 1))`,
          isNotNull(backupRuns.finishedAt),
          isNull(backupRuns.cleanupQueuedAt),
        ),
      )
      .orderBy(desc(backupRuns.finishedAt), desc(backupRuns.createdAt))

    if (runRows.length === 0) {
      continue
    }

    const allArtifacts: Array<
      Pick<
        typeof backupArtifacts.$inferSelect,
        'backupRunId' | 'storage' | 'objectKey' | 'sizeBytes'
      >
    > = []
    for (let offset = 0; offset < runRows.length; offset += 80) {
      allArtifacts.push(
        ...(await db
          .select({
            backupRunId: backupArtifacts.backupRunId,
            storage: backupArtifacts.storage,
            objectKey: backupArtifacts.objectKey,
            sizeBytes: backupArtifacts.sizeBytes,
          })
          .from(backupArtifacts)
          .where(
            inArray(
              backupArtifacts.backupRunId,
              runRows.slice(offset, offset + 80).map((run) => run.id),
            ),
          )),
      )
    }
    const expiredStorageByRunId = new Map<string, Set<'local' | 'remote'>>()

    for (const storage of ['local', 'remote'] as const) {
      const sizeByRunId = new Map<string, number>()
      const storageArtifacts = allArtifacts.filter(
        (artifact) => artifact.storage === storage,
      )

      if (storageArtifacts.length === 0) {
        continue
      }

      if (storage === 'remote' && !retention.remote.enabled) {
        continue
      }

      for (const artifact of storageArtifacts) {
        sizeByRunId.set(
          artifact.backupRunId,
          (sizeByRunId.get(artifact.backupRunId) ?? 0) +
            Number(artifact.sizeBytes),
        )
      }
      const storageExpiredRunIds = selectExpiredBackupRunIds({
        runs: runRows
          .filter((run) => sizeByRunId.has(run.id))
          .map((run) => ({
            id: run.id,
            finishedAt: run.finishedAt ?? run.createdAt,
            sizeBytes: sizeByRunId.get(run.id) ?? 0,
          })),
        retention: retention[storage],
        now,
      })

      if (storageExpiredRunIds.length === 0) {
        continue
      }

      for (const runId of storageExpiredRunIds) {
        const expiredStorage = expiredStorageByRunId.get(runId) ?? new Set()
        expiredStorage.add(storage)
        expiredStorageByRunId.set(runId, expiredStorage)
      }
    }

    if (expiredStorageByRunId.size === 0) {
      continue
    }

    const runIdsByServer = new Map<string, Array<string>>()
    for (const run of runRows) {
      if (!run.serverId || !expiredStorageByRunId.has(run.id)) continue
      const key = JSON.stringify([run.serverId, run.destination])
      const runIds = runIdsByServer.get(key) ?? []
      runIds.push(run.id)
      runIdsByServer.set(key, runIds)
    }

    for (const [groupKey, backupRunIdsToClean] of runIdsByServer) {
      const [serverId, snapshot] = JSON.parse(groupKey) as [
        string,
        BackupDestination | null,
      ]
      const hasExpiredRemoteArtifacts = allArtifacts.some(
        (artifact) =>
          backupRunIdsToClean.includes(artifact.backupRunId) &&
          artifact.storage === 'remote' &&
          expiredStorageByRunId.get(artifact.backupRunId)?.has('remote'),
      )
      // Only a registered destination can safely identify credentials for old files.
      // Resolve them at claim time; one unsupported snapshot must not stop a sweep.
      const parsedSnapshot = s3DestinationSchema.safeParse(snapshot)
      if (
        hasExpiredRemoteArtifacts &&
        (!parsedSnapshot.success || !parsedSnapshot.data.storageId)
      )
        continue
      const destination =
        hasExpiredRemoteArtifacts && parsedSnapshot.success
          ? backupDestinationSnapshot(parsedSnapshot.data)
          : { bucket: 'local-backups' }
      for (let offset = 0; offset < backupRunIdsToClean.length; offset += 50) {
        const backupRunIdChunk = backupRunIdsToClean.slice(offset, offset + 50)
        const runIds = new Set(backupRunIdChunk)
        const artifacts = allArtifacts.filter(
          (artifact) =>
            runIds.has(artifact.backupRunId) &&
            expiredStorageByRunId
              .get(artifact.backupRunId)
              ?.has(artifact.storage),
        )
        const jobId = randomUUID()
        const backupRunIds = await enqueueBackupCleanup(db, {
          jobId,
          projectId: config.projectId,
          serverId,
          backupRunIds: backupRunIdChunk,
          artifacts,
          destination,
          now,
        })
        if (backupRunIds.length > 0)
          queuedJobs.push({ id: jobId, backupRunIds })
      }
    }
  }

  return queuedJobs
}

export async function queueDueBackupSchedules({ now = new Date() } = {}) {
  const configRows = await db
    .select({
      config: backupConfigs,
      environment: environments,
      project: projects,
    })
    .from(backupConfigs)
    .innerJoin(environments, eq(environments.id, backupConfigs.environmentId))
    .innerJoin(projects, eq(projects.id, backupConfigs.projectId))
    .innerJoin(
      servers,
      eq(
        servers.id,
        sql<string>`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
      ),
    )
    .where(
      and(
        eq(backupConfigs.enabled, true),
        eq(projects.status, 'active'),
        eq(environments.status, 'active'),
        inArray(servers.status, ['connected', 'disconnected']),
        lte(backupConfigs.createdAt, now),
      ),
    )

  const queued: Array<{ backupRunId: string; agentJobId: string }> = []

  for (const row of configRows) {
    try {
      const schedule = backupScheduleSchema.parse(row.config.schedule)

      if (!isCronDue(schedule.cron, now)) {
        continue
      }

      if (!(row.environment.serverId ?? row.project.defaultServerId)) {
        continue
      }

      const queuedJob = await queueEnvironmentBackup({
        actor: { kind: 'system', source: 'backup.schedule' },
        projectId: row.config.projectId,
        environmentId: row.config.environmentId,
        backupConfigId: row.config.id,
        manifest: {
          trigger: 'schedule',
          schedule,
          scheduledAt: now.toISOString(),
        },
        scheduleKey: `${row.config.id}:${toUtcMinute(now)}`,
      })
      if (!queuedJob) {
        continue
      }

      queued.push({
        backupRunId: queuedJob.backupRunId,
        agentJobId: queuedJob.agentJobId,
      })
    } catch (error) {
      if (isWorkspacePolicyRefusal(error)) continue
      console.error('Scheduled backup admission failed', {
        policyId: row.config.id,
        ...safeErrorDiagnostics(error),
      })
    }
  }

  return queued
}

function selectExpiredBackupRunIds({
  runs,
  retention,
  now,
}: {
  runs: Array<{ id: string; finishedAt: Date; sizeBytes: number }>
  retention: BackupRetentionLimit
  now: Date
}) {
  if (
    retention.count === 0 &&
    retention.days === 0 &&
    retention.maxStorageGb === 0
  ) {
    return []
  }

  const expiredRunIds = new Set<string>()

  if (retention.count > 0) {
    for (const run of runs.slice(retention.count)) {
      expiredRunIds.add(run.id)
    }
  }

  if (retention.days > 0) {
    const cutoff = now.getTime() - retention.days * 86_400_000
    for (const run of runs) {
      if (run.finishedAt.getTime() < cutoff) {
        expiredRunIds.add(run.id)
      }
    }
  }

  if (retention.maxStorageGb > 0) {
    const maxStorageBytes = retention.maxStorageGb * 1024 * 1024 * 1024
    let keptBytes = 0

    for (const run of runs) {
      keptBytes += run.sizeBytes
      if (keptBytes > maxStorageBytes) {
        expiredRunIds.add(run.id)
      }
    }
  }

  return runs.filter((run) => expiredRunIds.has(run.id)).map((run) => run.id)
}

export function normalizeS3Destination(destination: BackupDestination) {
  const normalized = s3DestinationSchema.parse(destination)
  const prefix = normalized.prefix
    ?.replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim()

  if (prefix?.includes('..')) {
    throw new PublicError('BACKUP_DESTINATION_PREFIX_INVALID')
  }

  return {
    ...normalized,
    ...(prefix ? { prefix } : { prefix: undefined }),
  }
}

function buildBackupArtifactPrefix({
  destination,
  projectId,
  environmentId,
  backupRunId,
}: {
  destination: BackupDestination
  projectId: string
  environmentId: string
  backupRunId: string
}) {
  const prefix = destination.prefix?.trim().replace(/^\/+|\/+$/g, '')
  const base =
    prefix || `projects/${projectId}/environments/${environmentId}/backups`

  return `${base}/runs/${backupRunId}`
}

function buildBackupLocalBasePath({
  projectId,
  environmentId,
  backupRunId,
}: {
  projectId: string
  environmentId: string
  backupRunId: string
}) {
  return `/var/lib/devpush-agent/backups/${projectId}/${environmentId}/${backupRunId}`
}

function toUtcMinute(value: Date) {
  return value.toISOString().slice(0, 16)
}

function requireDatabaseArtifactTarget(
  objectKey: string,
  manifest: unknown,
): BackupDatabase {
  const targets =
    typeof manifest === 'object' &&
    manifest !== null &&
    'databaseTargets' in manifest
      ? z.array(storedBackupDatabaseSchema).parse(manifest.databaseTargets)
      : []
  const target = databaseArtifactTarget(objectKey, targets)
  if (!target || target.engine === 'needs_configuration')
    throw new PublicError('BACKUP_DATABASE_ENGINE_UNSUPPORTED')
  return target
}
