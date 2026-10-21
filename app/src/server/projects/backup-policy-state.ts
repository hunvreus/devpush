import { backupRetentionSchema } from '@/lib/backup-policy-schema'
import type { ApiMutationAdmission } from '@/server/api/admission'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { teamSettingsAccess } from '@/server/settings-version'

export async function saveProjectBackupPolicyState(
  store: AtomicStore,
  input: {
    projectId: string
    teamId: string
    userId: string
    settingsVersion: number | null
    policy: {
      id: string
      name: string
      environmentId: string
      enabled: boolean
      schedule: unknown
      destination: { storageId?: string }
      retention: unknown
      volumes: unknown
      databaseDumps: unknown
    }
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const p = input.policy
  const retention = backupRetentionSchema.parse(p.retention)
  const access = sql`${teamSettingsAccess(input.teamId, input.userId)} and exists(select 1 from projects where id = ${input.projectId} and team_id = ${input.teamId} and status = 'active')
    and exists(select 1 from environments where id = ${p.environmentId} and project_id = ${input.projectId} and status = 'active')
    and (${p.destination.storageId ?? null} is null or exists(select 1 from backup_storage where id = ${p.destination.storageId ?? null} and team_id = ${input.teamId})) and (${Number(retention.remote.enabled)} = 0 or ${p.destination.storageId ?? null} is not null) and ${input.admission?.guard ?? sql`1`}`
  const now = input.now.getTime()
  const effect =
    input.settingsVersion === null
      ? store.all(sql`insert into backup_configs (id,project_id,name,environment_id,enabled,destination_type,schedule,destination,retention,volumes,database_dumps,created_at,updated_at)
      select ${p.id},${input.projectId},${p.name},${p.environmentId},${Number(p.enabled)},'s3',${JSON.stringify(p.schedule)},${JSON.stringify(p.destination)},${JSON.stringify(retention)},${JSON.stringify(p.volumes)},${JSON.stringify(p.databaseDumps)},${now},${now}
      where ${access} and not exists(select 1 from backup_configs where id = ${p.id}) returning id`)
      : store.all(sql`update backup_configs set name = ${p.name},environment_id = ${p.environmentId},enabled = ${Number(p.enabled)},schedule = ${JSON.stringify(p.schedule)},destination = ${JSON.stringify(p.destination)},retention = ${JSON.stringify(retention)},volumes = ${JSON.stringify(p.volumes)},database_dumps = ${JSON.stringify(p.databaseDumps)},updated_at = ${now},settings_version = settings_version + 1
      where id = ${p.id} and project_id = ${input.projectId} and settings_version = ${input.settingsVersion} and ${access} returning id`)
  const [rows] = await store.batch([
    effect,
    ...(input.admission?.statements ?? []),
  ])
  return rows.length === 1
}

export async function deleteProjectBackupPolicyState(
  store: AtomicStore,
  input: {
    projectId: string
    teamId: string
    userId: string
    policyId: string
    settingsVersion: number
    admission?: ApiMutationAdmission
  },
) {
  const effect = store.all(
    sql`delete from backup_configs where id = ${input.policyId} and project_id = ${input.projectId} and settings_version = ${input.settingsVersion} and ${teamSettingsAccess(input.teamId, input.userId)} and exists(select 1 from projects where id = ${input.projectId} and status = 'active' and team_id = ${input.teamId}) and ${input.admission?.guard ?? sql`1`} returning id`,
  )
  const [rows] = await store.batch([
    effect,
    ...(input.admission?.statements ?? []),
  ])
  return rows.length === 1
}
