import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import type { ApiMutationAdmission } from '@/server/api/admission'
import { teamSettingsAccess } from '@/server/settings-version'

type StorageValues = {
  name: string
  bucket: string
  region: string
  endpoint: string | null
  accessKeyId: string
  secretAccessKeyCiphertext: string
}

export async function saveBackupStorageState(
  store: AtomicStore,
  input: {
    teamId: string
    userId: string
    storageId: string
    settingsVersion: number | null
    values: StorageValues
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const v = input.values
  const access = sql`${teamSettingsAccess(input.teamId, input.userId)} and ${input.admission?.guard ?? sql`1`}`
  const now = input.now.getTime()
  const effect =
    input.settingsVersion === null
      ? store.all(sql`insert into backup_storage (id,team_id,name,bucket,region,endpoint,access_key_id,secret_access_key_ciphertext,created_at,updated_at)
      select ${input.storageId},${input.teamId},${v.name},${v.bucket},${v.region},${v.endpoint},${v.accessKeyId},${v.secretAccessKeyCiphertext},${now},${now} where ${access} returning id`)
      : store.all(sql`update backup_storage set settings_version = settings_version + 1,
      name = ${v.name},access_key_id = ${v.accessKeyId},secret_access_key_ciphertext = ${v.secretAccessKeyCiphertext},updated_at = ${now}
      where id = ${input.storageId} and team_id = ${input.teamId} and settings_version = ${input.settingsVersion}
      and bucket = ${v.bucket} and region = ${v.region} and coalesce(endpoint,'') = ${v.endpoint ?? ''} and ${access} returning id`)
  const [rows] = await store.batch([
    effect,
    ...(input.admission?.statements ?? []),
  ])
  return rows.length === 1
}

export async function deleteBackupStorageState(
  store: AtomicStore,
  input: {
    teamId: string
    userId: string
    storageId: string
    settingsVersion: number
    admission?: ApiMutationAdmission
  },
) {
  // A cleanup completion can remove only local files. Remaining remote artifact
  // rows, not the run's last-cleanup timestamp, decide whether credentials are needed.
  const unreferenced = sql`not exists(select 1 from backup_configs where json_extract(destination,'$.storageId') = ${input.storageId})
    and not exists(select 1 from backup_runs as run where json_extract(run.destination,'$.storageId') = ${input.storageId}
      and (run.status in ('queued','running') or exists(select 1 from backup_artifacts where backup_run_id = run.id and storage = 'remote')))`
  const [rows] = await store.batch([
    store.all(sql`delete from backup_storage where id = ${input.storageId} and team_id = ${input.teamId}
      and settings_version = ${input.settingsVersion} and ${teamSettingsAccess(input.teamId, input.userId)}
      and ${input.admission?.guard ?? sql`1`} and ${unreferenced} returning id`),
    ...(input.admission?.statements ?? []),
  ])
  return rows.length === 1
}
