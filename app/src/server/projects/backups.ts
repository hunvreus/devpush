import { withWorkspaceAccess } from '#devpush/server/plugins/workspace-access'
import { requireBackupsEnabled } from '#devpush/server/backups/feature'
import { getProjectSettingsContext } from './settings-context'
import { PublicError } from '#devpush/lib/public-error'
import { prepareBackupPolicy } from '#devpush/server/backups/policy-validation'

import { canManageTeamSettings } from '#devpush/lib/team-role'
import type { TeamRole } from '#devpush/lib/team-role'
import { db } from '#devpush/server/db'
import {
  saveProjectBackupPolicyState,
  deleteProjectBackupPolicyState,
} from './backup-policy-state'
import {
  queueBackupRestoreJob,
  queueEnvironmentBackup,
} from '#devpush/server/backups/service'
import { getProjectContext } from './context'
import type { BackupDestinationInput, ProjectBackupConfig } from './types'

export async function saveProjectBackupPolicy({
  projectId,
  userId,
  teamSlug,
  projectName,
  policy,
  settingsVersion,
}: {
  projectId?: string
  userId: string
  teamSlug: string
  projectName: string
  settingsVersion: number | null
  policy: Omit<ProjectBackupConfig, 'settingsVersion' | 'destination'> & {
    destination: BackupDestinationInput
  }
}) {
  requireBackupsEnabled()
  const context = await getProjectSettingsContext({
    projectId,
    reloadSection: 'backups',
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'backup.policy.save',
    async () => {
      requireBackupManagement(context.team.role)
      const normalized = await prepareBackupPolicy({
        teamId: context.team.id,
        projectId: context.project.id,
        policy,
      })
      const changed = await saveProjectBackupPolicyState(db, {
        projectId: context.project.id,
        teamId: context.team.id,
        userId,
        settingsVersion,
        policy: normalized,
        now: new Date(),
      })
      if (!changed) throw new PublicError('SETTINGS_CONFLICT')
      return getProjectContext({
        userId,
        teamSlug,
        projectName,
        scope: 'backups',
      })
    },
    { kind: 'user', userId },
  )
}

export async function deleteProjectBackupPolicy({
  projectId,
  userId,
  teamSlug,
  projectName,
  policyId,
  settingsVersion,
}: {
  projectId?: string
  userId: string
  teamSlug: string
  projectName: string
  policyId: string
  settingsVersion: number
}) {
  requireBackupsEnabled()
  const context = await getProjectSettingsContext({
    projectId,
    reloadSection: 'backups',
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  return withWorkspaceAccess(
    context.team.id,
    'backup.policy.delete',
    async () => {
      requireBackupManagement(context.team.role)
      if (
        !(await deleteProjectBackupPolicyState(db, {
          projectId: context.project.id,
          teamId: context.team.id,
          userId,
          policyId,
          settingsVersion,
        }))
      )
        throw new PublicError('SETTINGS_CONFLICT')
      return getProjectContext({
        userId,
        teamSlug,
        projectName,
        scope: 'backups',
      })
    },
    { kind: 'user', userId },
  )
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
  requireBackupsEnabled()
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
    throw new PublicError('BACKUP_POLICY_NOT_FOUND')
  }

  requireBackupManagement(context.team.role)
  const queued = await queueEnvironmentBackup({
    actor: { kind: 'user', userId: userId },
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
    throw new PublicError('BACKUP_ALREADY_ACTIVE')
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
  requireBackupsEnabled()
  const context = await getProjectContext({
    userId,
    teamSlug,
    projectName,
    scope: 'shell',
  })
  requireBackupManagement(context.team.role)

  await queueBackupRestoreJob({
    actor: { kind: 'user', userId: userId },
    projectId: context.project.id,
    backupRunId,
    artifacts,
  })

  return getProjectContext({ userId, teamSlug, projectName, scope: 'backups' })
}

function requireBackupManagement(role: TeamRole) {
  if (!canManageTeamSettings(role)) {
    throw new PublicError('BACKUP_MANAGEMENT_FORBIDDEN')
  }
}
