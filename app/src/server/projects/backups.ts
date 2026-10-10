import { backupStorageReferenceSchema } from '@/lib/backup-storage-schema'
import { resolveBackupDestination } from '@/server/backups/storage'
import { eq } from 'drizzle-orm'

import { canManageTeamSettings } from '@/lib/team-role'
import type { TeamRole } from '@/lib/team-role'
import { db } from '@/server/db'
import { backupConfigs } from '@/server/db/schema'
import {
  queueBackupRestoreJob,
  queueEnvironmentBackup,
} from '@/server/backups/service'
import { getProjectContext } from './context'
import { normalizeBackupVolumes, parseBackupSchedule } from './mappers'
import type { BackupDestinationInput, ProjectBackupConfig } from './types'

export async function updateProjectBackupConfigs({
  userId,
  teamSlug,
  projectName,
  backupConfigs: nextBackupConfigs,
}: {
  userId: string
  teamSlug: string
  projectName: string
  backupConfigs: Array<
    Omit<ProjectBackupConfig, 'destination'> & {
      destination: BackupDestinationInput
    }
  >
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  requireBackupManagement(context.team.role)
  const environmentIds = new Set(context.environments.map((item) => item.id))
  const normalizedConfigs = nextBackupConfigs
    .filter((item) => item.environmentId.trim() !== '')
    .map((item) => ({
      id: item.id.trim() || crypto.randomUUID(),
      name: item.name.trim(),
      environmentId: item.environmentId,
      enabled: item.enabled,
      schedule: parseBackupSchedule(item.schedule),
      destination: backupStorageReferenceSchema.parse(item.destination),
      retention: item.retention,
      volumes: normalizeBackupVolumes(item.volumes),
      databaseDumps: item.databaseDumps.map((dump) => ({
        service: dump.service.trim(),
        engine: dump.engine,
        database: dump.database.trim(),
      })),
    }))

  for (const backupConfig of normalizedConfigs) {
    if (!backupConfig.name) {
      throw new Error('Backup name is required.')
    }

    if (!environmentIds.has(backupConfig.environmentId)) {
      throw new Error('Select a valid backup environment.')
    }

    if (
      backupConfig.destination.storageId ||
      backupConfig.retention.remote.enabled
    ) {
      await resolveBackupDestination(context.team.id, backupConfig.destination)
    }
  }

  const now = new Date()

  const values: Array<typeof backupConfigs.$inferInsert> =
    normalizedConfigs.map((backupConfig) => ({
      id: backupConfig.id,
      name: backupConfig.name,
      projectId: context.project.id,
      environmentId: backupConfig.environmentId,
      enabled: backupConfig.enabled,
      destinationType: 's3',
      schedule: backupConfig.schedule,
      destination: backupConfig.destination,
      retention: backupConfig.retention,
      volumes: backupConfig.volumes,
      databaseDumps: backupConfig.databaseDumps,
      createdAt: now,
      updatedAt: now,
    }))
  const inserts = []
  // Fourteen columns per config: six rows keep each statement below D1's
  // parameter limit while the entire replacement stays atomic.
  for (let offset = 0; offset < values.length; offset += 6) {
    inserts.push(
      db.insert(backupConfigs).values(values.slice(offset, offset + 6)),
    )
  }
  await db.batch([
    db
      .delete(backupConfigs)
      .where(eq(backupConfigs.projectId, context.project.id)),
    ...inserts,
  ])

  return getProjectContext({ userId, teamSlug, projectName, scope: 'backups' })
}

export async function createManualBackupRun({
  backupConfigId,
  userId,
  teamSlug,
  projectName,
}: {
  backupConfigId: string
  userId: string
  teamSlug: string
  projectName: string
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'backups',
  })
  const backupConfig = context.backupConfigs.find(
    (candidate) => candidate.id === backupConfigId,
  )

  if (!backupConfig) {
    throw new Error('Backup policy not found.')
  }

  requireBackupManagement(context.team.role)
  const queued = await queueEnvironmentBackup({
    backupConfigId,
    projectId: context.project.id,
    environmentId: backupConfig.environmentId,
    manifest: {
      trigger: 'manual',
      backupConfigId,
      requestedAt: new Date().toISOString(),
    },
  })
  if (!queued) {
    throw new Error(
      'A backup is already queued or running for this environment.',
    )
  }

  return getProjectContext({ userId, teamSlug, projectName, scope: 'backups' })
}

export async function createBackupRestoreJob({
  userId,
  teamSlug,
  projectName,
  backupRunId,
  artifacts,
}: {
  userId: string
  teamSlug: string
  projectName: string
  backupRunId: string
  artifacts: Array<
    | {
        artifactId: string
        type: 'volume'
        targetVolume: string
      }
    | {
        artifactId: string
        type: 'database'
        targetService: string
      }
  >
}) {
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  requireBackupManagement(context.team.role)

  await queueBackupRestoreJob({
    projectId: context.project.id,
    backupRunId,
    artifacts,
  })

  return getProjectContext({ userId, teamSlug, projectName, scope: 'backups' })
}

function requireBackupManagement(role: TeamRole) {
  if (!canManageTeamSettings(role)) {
    throw new Error(
      'Only team owners and admins can configure backups or restore data.',
    )
  }
}
