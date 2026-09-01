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

const s3DestinationSchema = z.object({
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

const databaseDumpSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'Backup dump services can only contain letters, numbers, dots, underscores, and hyphens.',
    ),
  command: z.string().trim().min(1).max(2_000),
})

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
    restoreCommand: z.string().trim().min(1).max(2_000),
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
export type BackupDatabaseDump = z.infer<typeof databaseDumpSchema>
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
  destination: BackupDestination
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
  databaseDumps: Array<BackupDatabaseDump>
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
  destination: BackupDestination
  retention?: BackupRetentionPolicy
  volumes?: BackupVolumeSelection
  databaseDumps?: Array<BackupDatabaseDump>
}) {
  const normalizedDestination = normalizeS3Destination(destination)
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

  return toBackupConfigSummary(rows[0])
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

  return toBackupRunSummary(rows[0])
}

export async function queueEnvironmentBackup({
  projectId,
  environmentId,
  deploymentId,
  manifest,
  scheduleKey,
}: {
  projectId: string
  environmentId: string
  deploymentId?: string | null
  manifest?: unknown
  scheduleKey?: string
}) {
  const rows = await db
    .select({
      config: backupConfigs,
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
  const destination = s3DestinationSchema.parse(row.config.destination)
  const retention = backupRetentionSchema.parse(row.config.retention)
  const volumes = normalizeBackupVolumes(row.config.volumes)
  const databaseDumps = z
    .array(databaseDumpSchema)
    .parse(row.config.databaseDumps)
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
    databaseDumps,
  } satisfies BackupJobPayload

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(backupRuns)
      .values({
        id: backupRunId,
        projectId,
        environmentId,
        deploymentId: deploymentId ?? null,
        serverId,
        runtimeId: row.environment.runtimeId,
        scheduleKey,
        status: 'queued',
        manifest: manifest ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: backupRuns.id })

    if (!inserted.at(0)) {
      return false
    }

    await tx.insert(agentJobs).values({
      id: agentJobId,
      type: 'backup',
      status: 'queued',
      serverId,
      teamId: null,
      projectId,
      payload,
      maxAttempts: 5,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })

    return true
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
  const rows = await db
    .insert(backupArtifacts)
    .values(
      normalizedArtifacts.map((artifact) => ({
        id: randomUUID(),
        backupRunId,
        type: artifact.type,
        storage: artifact.storage,
        objectKey: artifact.objectKey,
        checksumSha256: artifact.checksumSha256,
        sizeBytes: artifact.sizeBytes,
        createdAt: now,
      })),
    )
    .returning({
      id: backupArtifacts.id,
      type: backupArtifacts.type,
      objectKey: backupArtifacts.objectKey,
      checksumSha256: backupArtifacts.checksumSha256,
      sizeBytes: backupArtifacts.sizeBytes,
    })

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

  if (row.run.status !== 'succeeded') {
    throw new Error('Only successful backup runs can be restored.')
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
        inArray(
          backupArtifacts.id,
          requestedArtifacts.map((artifact) => artifact.artifactId),
        ),
      ),
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
        restoreCommand: requested.restoreCommand,
      })
    }
  }

  const configDestination = row.config
    ? s3DestinationSchema.parse(row.config.destination)
    : null
  const destination =
    needsRemoteDestination && configDestination
      ? buildRestoreJobDestination(configDestination)
      : undefined

  if (needsRemoteDestination && !destination) {
    throw new Error('Remote restore credentials are not configured.')
  }

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
    const destination = s3DestinationSchema.parse(config.destination)

    const runRows = await db
      .select()
      .from(backupRuns)
      .where(
        and(
          eq(backupRuns.environmentId, config.environmentId),
          eq(backupRuns.status, 'succeeded'),
          isNotNull(backupRuns.finishedAt),
          isNull(backupRuns.cleanupQueuedAt),
        ),
      )
      .orderBy(desc(backupRuns.finishedAt), desc(backupRuns.createdAt))

    if (runRows.length === 0) {
      continue
    }

    const allArtifacts = await db
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
          runRows.map((run) => run.id),
        ),
      )
    const expiredRunIds = new Set<string>()
    const expiredObjectKeys = {
      local: [] as Array<string>,
      remote: [] as Array<string>,
    }

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
        runs: runRows.map((run) => ({
          id: run.id,
          finishedAt: run.finishedAt ?? run.createdAt,
          sizeBytes: sizeByRunId.get(run.id) ?? 0,
        })),
        retention: retention[storage],
      })

      if (storageExpiredRunIds.length === 0) {
        continue
      }

      for (const runId of storageExpiredRunIds) {
        expiredRunIds.add(runId)
      }

      const artifacts = storageArtifacts.filter((artifact) =>
        storageExpiredRunIds.includes(artifact.backupRunId),
      )
      expiredObjectKeys[storage] = Array.from(
        new Set(artifacts.map((artifact) => artifact.objectKey).sort()),
      )
    }

    const backupRunIdsToClean = Array.from(expiredRunIds)

    if (
      backupRunIdsToClean.length === 0 ||
      (expiredObjectKeys.local.length === 0 &&
        expiredObjectKeys.remote.length === 0)
    ) {
      continue
    }

    const serverId = runRows.find((run) =>
      backupRunIdsToClean.includes(run.id),
    )?.serverId

    if (!serverId) {
      continue
    }

    const jobId = randomUUID()
    const payload = {
      schemaVersion: 1,
      backupRunIds: backupRunIdsToClean,
      ...(expiredObjectKeys.remote.length > 0 ? { destination } : {}),
      localObjectKeys: expiredObjectKeys.local,
      remoteObjectKeys: expiredObjectKeys.remote,
      reason: 'Backup retention expired.',
    } satisfies BackupCleanupJobPayload

    await db.transaction(async (tx) => {
      const queuedRunRows = await tx
        .update(backupRuns)
        .set({
          cleanupQueuedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            inArray(backupRuns.id, backupRunIdsToClean),
            isNull(backupRuns.cleanupQueuedAt),
          ),
        )
        .returning({ id: backupRuns.id })
      const backupRunIds = queuedRunRows.map((run) => run.id)

      if (backupRunIds.length === 0) {
        return
      }

      await tx.insert(agentJobs).values({
        id: jobId,
        type: 'backup_cleanup',
        status: 'queued',
        serverId,
        projectId: config.projectId,
        payload: {
          ...payload,
          backupRunIds,
        },
        maxAttempts: 5,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })

      queuedJobs.push({ id: jobId, backupRunIds })
    })
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
      manifest: {
        trigger: 'schedule',
        schedule,
        scheduledAt: now.toISOString(),
      },
      scheduleKey: `${row.config.environmentId}:${toUtcMinute(now)}`,
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
}: {
  runs: Array<{ id: string; finishedAt: Date; sizeBytes: number }>
  retention: BackupRetentionLimit
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
    const cutoff = Date.now() - retention.days * 86_400_000
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

function normalizeS3Destination(destination: BackupDestination) {
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
  return `/var/lib/devpush/backups/${projectId}/${environmentId}/${backupRunId}`
}

export function isCronDue(cron: string, now: Date) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/)

  const minuteMatches = matchesCronPart(minute, now.getUTCMinutes(), 0, 59)
  const hourMatches = matchesCronPart(hour, now.getUTCHours(), 0, 23)
  const monthMatches = matchesCronPart(month, now.getUTCMonth() + 1, 1, 12)
  const dayOfMonthMatches = matchesCronPart(dayOfMonth, now.getUTCDate(), 1, 31)
  const dayOfWeekMatches = matchesCronPart(dayOfWeek, now.getUTCDay(), 0, 7)
  const dayMatches =
    dayOfMonth === '*'
      ? dayOfWeekMatches
      : dayOfWeek === '*'
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches

  return minuteMatches && hourMatches && monthMatches && dayMatches
}

export function isValidCron(cron: string) {
  const parts = cron.trim().split(/\s+/)
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const

  return (
    parts.length === 5 &&
    parts.every((part, index) =>
      isValidCronPart(part, ranges[index][0], ranges[index][1]),
    )
  )
}

function isValidCronPart(part: string, min: number, max: number) {
  return part.split(',').every((token) => {
    const segments = token.split('/')
    const base = segments[0]
    const hasStep = segments.length === 2
    if (segments.length > 2 || !base) return false

    if (hasStep) {
      const step = Number(segments[1])
      if (!Number.isInteger(step) || step < 1 || step > max - min + 1) {
        return false
      }
    }

    if (base === '*') return true

    if (base.includes('-')) {
      const range = base.split('-')
      if (range.length !== 2) return false
      const start = Number(range[0])
      const end = Number(range[1])
      return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= min &&
        end <= max &&
        start <= end
      )
    }

    const numeric = Number(base)
    return (
      !hasStep && Number.isInteger(numeric) && numeric >= min && numeric <= max
    )
  })
}

function matchesCronPart(
  part: string,
  value: number,
  min: number,
  max: number,
) {
  for (const token of part.split(',')) {
    const [base, rawStep] = token.split('/')
    const step = rawStep ? Number(rawStep) : 1
    let start = min
    let end = max

    if (base !== '*') {
      if (base.includes('-')) {
        const [rawStart, rawEnd] = base.split('-', 2)
        start = Number(rawStart)
        end = Number(rawEnd)
      } else {
        start = Number(base)
        end = start
      }
    }

    const normalizedValue = max === 7 && value === 0 && end === 7 ? 7 : value
    if (
      normalizedValue >= start &&
      normalizedValue <= end &&
      (normalizedValue - start) % step === 0
    ) {
      return true
    }
  }

  return false
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
    destination: s3DestinationSchema.parse(row.destination),
    retention: backupRetentionSchema.parse(row.retention),
    volumes: normalizeBackupVolumes(row.volumes),
    databaseDumps: z.array(databaseDumpSchema).parse(row.databaseDumps),
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
