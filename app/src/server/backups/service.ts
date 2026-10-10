import {
  backupDatabaseSchema,
  storedBackupDatabaseSchema,
  databaseArtifactTarget,
  type BackupDatabase,
} from '@/lib/backup-database'
import {
  buildDatabaseBackupCommand,
  buildDatabaseRestoreCommand,
} from './database-commands'
import { backupStorageReferenceSchema } from '@/lib/backup-storage-schema'
import type { BackupStorageReference } from '@/lib/backup-storage-schema'
import { resolveBackupDestination, refreshBackupCredentials } from './storage'
import { enqueueBackup, enqueueBackupCleanup } from './queue-state'
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

import { db } from '@/server/db'
import {
  agentJobs,
  backupArtifacts,
  backupConfigs,
  backupRuns,
  environments,
  projects,
  servers,
} from '@/server/db/schema'
import { isCronDue, isValidCron } from './cron'

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

const retentionLimitSchema = z.object({
  count: z.number().int().min(0).max(10_000),
  days: z.number().int().min(0).max(3650),
  maxStorageGb: z.number().min(0).max(100_000),
})

export const backupRetentionSchema = z.object({
  local: retentionLimitSchema,
  remote: retentionLimitSchema.extend({
    enabled: z.boolean(),
  }),
})

const databaseDumpSchema = backupDatabaseSchema

const backupScheduleSchema = z.object({
  cron: z
    .string()
    .trim()
    .refine(isValidCron, 'Enter a valid five-field cron expression.'),
})

const backupVolumesSchema = z.object({
  mode: z.enum(['none', 'allNamed', 'selected']),
  names: z.array(
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Backup volume names can only contain letters, numbers, dots, underscores, and hyphens.',
      ),
  ),
})

const backupArtifactSchema = z.object({
  type: z.enum(['manifest', 'volume', 'database']),
  storage: z.enum(['local', 'remote']),
  objectKey: z.string().trim().min(1).max(1_024),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
})

const restoreArtifactSchema = z.discriminatedUnion('type', [
  z.object({
    artifactId: z.string().trim().min(1),
    type: z.literal('volume'),
    targetVolume: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Restore target volumes can only contain letters, numbers, dots, underscores, and hyphens.',
      ),
  }),
  z.object({
    artifactId: z.string().trim().min(1),
    type: z.literal('database'),
    targetService: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Restore target services can only contain letters, numbers, dots, underscores, and hyphens.',
      ),
  }),
])

const defaultBackupRetention = {
  local: {
    count: 7,
    days: 0,
    maxStorageGb: 0,
  },
  remote: {
    enabled: false,
    count: 7,
    days: 0,
    maxStorageGb: 0,
  },
} satisfies BackupRetentionPolicy

const defaultBackupVolumes = {
  mode: 'allNamed',
  names: [],
} satisfies BackupVolumeSelection

export type BackupDestination = z.infer<typeof s3DestinationSchema>
type BackupRetentionLimit = z.infer<typeof retentionLimitSchema>
export type BackupRetentionPolicy = z.infer<typeof backupRetentionSchema>
export type BackupDatabaseDump = BackupDatabase
export type BackupVolumeSelection = z.infer<typeof backupVolumesSchema>
export type BackupArtifactInput = z.infer<typeof backupArtifactSchema>
export type BackupRestoreArtifactInput = z.infer<typeof restoreArtifactSchema>
export type BackupSchedule = z.infer<typeof backupScheduleSchema>

type BackupConfigSummary = {
  id: string
  name: string
  projectId: string
  environmentId: string
  enabled: boolean
  schedule: BackupSchedule
  destination: BackupStorageReference
  retention: BackupRetentionPolicy
  volumes: BackupVolumeSelection
  databaseDumps: Array<BackupDatabaseDump>
}

type BackupRunSummary = {
  id: string
  projectId: string
  environmentId: string
  deploymentId: string | null
  serverId: string | null
  runtimeId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  errorMessage: string | null
  createdAt: string
  finishedAt: string | null
}

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

export async function upsertBackupConfig({
  projectId,
  environmentId,
  name,
  enabled,
  schedule = { cron: '0 2 * * *' },
  destination,
  retention = defaultBackupRetention,
  volumes = defaultBackupVolumes,
  databaseDumps = [],
}: {
  projectId: string
  environmentId: string
  name?: string
  enabled: boolean
  schedule?: BackupSchedule
  destination: BackupStorageReference
  retention?: BackupRetentionPolicy
  volumes?: BackupVolumeSelection
  databaseDumps?: Array<BackupDatabaseDump>
}) {
  const normalizedDestination = backupStorageReferenceSchema.parse(destination)
  const normalizedSchedule = backupScheduleSchema.parse(schedule)
  const normalizedRetention = backupRetentionSchema.parse(retention)
  const normalizedVolumes = backupVolumesSchema.parse(volumes)
  const normalizedDatabaseDumps = databaseDumps.map((dump) =>
    databaseDumpSchema.parse(dump),
  )

  await assertEnvironmentBelongsToProject({ projectId, environmentId })

  const now = new Date()
  const existingConfig = (
    await db
      .select({ id: backupConfigs.id })
      .from(backupConfigs)
      .where(
        and(
          eq(backupConfigs.projectId, projectId),
          eq(backupConfigs.environmentId, environmentId),
        ),
      )
      .limit(1)
  ).at(0)

  const values = {
    name: name?.trim() || 'Backup',
    enabled,
    destinationType: 's3' as const,
    schedule: normalizedSchedule,
    destination: normalizedDestination,
    retention: normalizedRetention,
    volumes: normalizedVolumes,
    databaseDumps: normalizedDatabaseDumps,
    updatedAt: now,
  }

  const rows = existingConfig
    ? await db
        .update(backupConfigs)
        .set(values)
        .where(eq(backupConfigs.id, existingConfig.id))
        .returning()
    : await db
        .insert(backupConfigs)
        .values({
          id: randomUUID(),
          projectId,
          environmentId,
          ...values,
          createdAt: now,
        })
        .returning()

  const saved = rows[0]
  if (!saved) throw new Error('Backup config was not saved.')
  return toBackupConfigSummary(saved)
}

export async function listProjectBackupConfigs(projectId: string) {
  const rows = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.projectId, projectId))

  return rows.map(toBackupConfigSummary)
}

export async function createBackupRun({
  projectId,
  environmentId,
  deploymentId,
  serverId,
  runtimeId,
  manifest,
}: {
  projectId: string
  environmentId: string
  deploymentId?: string | null
  serverId?: string | null
  runtimeId: string
  manifest?: unknown
}) {
  if (!runtimeId.trim()) {
    throw new Error('Backup runtime ID is required.')
  }

  await assertEnvironmentBelongsToProject({ projectId, environmentId })

  const rows = await db
    .insert(backupRuns)
    .values({
      id: randomUUID(),
      projectId,
      environmentId,
      deploymentId: deploymentId ?? null,
      serverId: serverId ?? null,
      runtimeId,
      status: 'queued',
      manifest: manifest ?? null,
    })
    .returning()

  const saved = rows[0]
  if (!saved) throw new Error('Backup run was not saved.')
  return toBackupRunSummary(saved)
}

export async function queueEnvironmentBackup({
  projectId,
  environmentId,
  deploymentId,
  manifest,
  scheduleKey,
  backupConfigId,
}: {
  projectId: string
  environmentId: string
  deploymentId?: string | null
  manifest?: unknown
  scheduleKey?: string
  backupConfigId?: string
}) {
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
    .limit(1)
  const row = rows.at(0)

  if (!row) {
    throw new Error('Enabled backup configuration not found.')
  }

  const serverId = row.environment.serverId ?? row.project.defaultServerId

  if (!serverId) {
    throw new Error('Backup environment is not assigned to a server.')
  }
  const reference = backupStorageReferenceSchema.parse(row.config.destination)
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
    throw new Error('Update the server agent before running MongoDB backups.')
  }
  const now = new Date()
  const backupRunId = randomUUID()
  const agentJobId = randomUUID()
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
      ...(typeof manifest === 'object' && manifest !== null ? manifest : {}),
      databaseTargets: databaseDumps,
    },
    payload,
    now,
  })

  if (!created) {
    return null
  }

  return {
    backupRunId,
    agentJobId,
    payload,
  }
}

function buildBackupJobDestination({
  destination,
  retention,
}: {
  destination: BackupDestination
  retention: BackupRetentionPolicy
}): BackupJobPayload['destination'] {
  if (!retention.remote.enabled) {
    return stripStoredSecret(destination)
  }

  if (!destination.accessKeyId || !destination.secretAccessKeyCiphertext) {
    throw new Error('Remote backup credentials are not configured.')
  }

  return {
    ...stripStoredSecret(destination),
    secretAccessKeyCiphertext: destination.secretAccessKeyCiphertext,
  }
}

function stripStoredSecret(destination: BackupDestination) {
  return {
    storageId: destination.storageId,
    bucket: destination.bucket,
    region: destination.region,
    endpoint: destination.endpoint,
    prefix: destination.prefix,
    accessKeyId: destination.accessKeyId,
    secretAccessKeyPreview: destination.secretAccessKeyPreview,
  }
}

export async function recordBackupArtifacts({
  backupRunId,
  artifacts,
}: {
  backupRunId: string
  artifacts: Array<BackupArtifactInput>
}) {
  if (artifacts.length === 0) {
    return []
  }

  const normalizedArtifacts = artifacts.map((artifact) =>
    backupArtifactSchema.parse(artifact),
  )
  const now = new Date()
  const values = normalizedArtifacts.map((artifact) => ({
    id: randomUUID(),
    backupRunId,
    type: artifact.type,
    storage: artifact.storage,
    objectKey: artifact.objectKey,
    checksumSha256: artifact.checksumSha256,
    sizeBytes: artifact.sizeBytes,
    createdAt: now,
  }))
  const statements = []
  for (let offset = 0; offset < values.length; offset += 8) {
    statements.push(
      db
        .insert(backupArtifacts)
        .values(values.slice(offset, offset + 8))
        .returning({
          id: backupArtifacts.id,
          type: backupArtifacts.type,
          objectKey: backupArtifacts.objectKey,
          checksumSha256: backupArtifacts.checksumSha256,
          sizeBytes: backupArtifacts.sizeBytes,
        }),
    )
  }
  const rows = (await db.batch([statements[0]!, ...statements.slice(1)])).flat()

  return rows
}

export async function queueBackupRestoreJob({
  projectId,
  backupRunId,
  artifacts,
}: {
  projectId: string
  backupRunId: string
  artifacts: Array<BackupRestoreArtifactInput>
}) {
  const requestedArtifacts = artifacts.map((artifact) =>
    restoreArtifactSchema.parse(artifact),
  )

  if (requestedArtifacts.length === 0) {
    throw new Error('Select at least one backup artifact to restore.')
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
    throw new Error('Backup run not found.')
  }

  const localRecovery =
    row.run.status === 'failed' &&
    row.run.manifest !== null &&
    typeof row.run.manifest === 'object' &&
    'localRecoveryAvailable' in row.run.manifest &&
    row.run.manifest.localRecoveryAvailable === true
  if (row.run.status !== 'succeeded' && !localRecovery) {
    throw new Error('This backup has no recoverable artifacts.')
  }

  const effectiveServerId =
    row.environment.serverId ?? row.project.defaultServerId

  if (!row.run.serverId || row.run.serverId !== effectiveServerId) {
    throw new Error(
      'Backup run is not assigned to the current environment server.',
    )
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
    throw new Error(
      'Only local artifacts from this failed backup can be restored.',
    )

  if (artifactRows.length !== requestedArtifacts.length) {
    throw new Error('One or more backup artifacts were not found.')
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
      throw new Error('Backup artifact type does not match the restore target.')
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
          requireDatabaseArtifactTarget(artifact.objectKey, row.run.manifest),
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
    throw new Error('The original remote backup destination is unavailable.')

  const now = new Date()
  const jobId = randomUUID()
  const payload = {
    schemaVersion: 1,
    backupRunId,
    projectId,
    environmentId: row.run.environmentId,
    runtimeId: row.run.runtimeId,
    destination,
    artifacts: restoreArtifacts,
  } satisfies BackupRestoreJobPayload

  await db.insert(agentJobs).values({
    id: jobId,
    type: 'restore',
    status: 'queued',
    serverId: row.run.serverId,
    teamId: null,
    projectId,
    payload,
    maxAttempts: 1,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  })

  return {
    agentJobId: jobId,
    payload,
  }
}

function buildRestoreJobDestination(
  destination: BackupDestination,
): BackupRestoreJobPayload['destination'] {
  if (!destination.accessKeyId || !destination.secretAccessKeyCiphertext) {
    throw new Error('Remote restore credentials are not configured.')
  }

  return {
    ...stripStoredSecret(destination),
    secretAccessKeyCiphertext: destination.secretAccessKeyCiphertext,
  }
}

export async function listEnvironmentBackupRuns(environmentId: string) {
  const rows = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.environmentId, environmentId))
    .orderBy(desc(backupRuns.createdAt))

  return rows.map(toBackupRunSummary)
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
    const retention = backupRetentionSchema.parse(config.retention)

    const runRows = await db
      .select()
      .from(backupRuns)
      .where(
        and(
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
      const project = (
        await db
          .select({ teamId: projects.teamId })
          .from(projects)
          .where(eq(projects.id, config.projectId))
          .limit(1)
      ).at(0)
      if (!project) continue
      const hasExpiredRemoteArtifacts = allArtifacts.some(
        (artifact) =>
          backupRunIdsToClean.includes(artifact.backupRunId) &&
          artifact.storage === 'remote' &&
          expiredStorageByRunId.get(artifact.backupRunId)?.has('remote'),
      )
      const destination =
        snapshot && hasExpiredRemoteArtifacts
          ? await refreshBackupCredentials(
              project.teamId,
              s3DestinationSchema.parse(snapshot),
            )
          : { bucket: 'local-backups' }
      // Old runs without a recoverable destination must never delete remote files using today's policy.
      if (
        !snapshot &&
        allArtifacts.some(
          (artifact) =>
            backupRunIdsToClean.includes(artifact.backupRunId) &&
            artifact.storage === 'remote' &&
            expiredStorageByRunId.get(artifact.backupRunId)?.has('remote'),
        )
      )
        continue
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
    const schedule = backupScheduleSchema.parse(row.config.schedule)

    if (!isCronDue(schedule.cron, now)) {
      continue
    }

    if (!(row.environment.serverId ?? row.project.defaultServerId)) {
      continue
    }

    const queuedJob = await queueEnvironmentBackup({
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

async function assertEnvironmentBelongsToProject({
  projectId,
  environmentId,
}: {
  projectId: string
  environmentId: string
}) {
  const rows = await db
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.status, 'active'),
        eq(environments.id, environmentId),
      ),
    )
    .limit(1)

  if (!rows.at(0)) {
    throw new Error('Backup environment not found.')
  }
}

export function normalizeS3Destination(destination: BackupDestination) {
  const normalized = s3DestinationSchema.parse(destination)
  const prefix = normalized.prefix
    ?.replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim()

  if (prefix?.includes('..')) {
    throw new Error('Backup destination prefixes cannot contain .. segments.')
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

function toBackupConfigSummary(row: typeof backupConfigs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    environmentId: row.environmentId,
    enabled: row.enabled,
    schedule: backupScheduleSchema.parse(row.schedule),
    destination: backupStorageReferenceSchema.parse(row.destination),
    retention: backupRetentionSchema.parse(row.retention),
    volumes: normalizeBackupVolumes(row.volumes),
    databaseDumps: z.array(storedBackupDatabaseSchema).parse(row.databaseDumps),
  } satisfies BackupConfigSummary
}

function normalizeBackupVolumes(value: unknown): BackupVolumeSelection {
  if (typeof value === 'object' && value !== null) {
    const parsed = backupVolumesSchema.safeParse(value)

    if (parsed.success) {
      if (parsed.data.mode === 'none') {
        return { mode: 'none', names: [] }
      }

      return parsed.data.mode === 'selected' && parsed.data.names.length === 0
        ? defaultBackupVolumes
        : parsed.data
    }
  }

  return defaultBackupVolumes
}

function toBackupRunSummary(row: typeof backupRuns.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    deploymentId: row.deploymentId,
    serverId: row.serverId,
    runtimeId: row.runtimeId,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  } satisfies BackupRunSummary
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
    throw new Error(
      'This backup has no supported database engine metadata. Restore it manually.',
    )
  return target
}
