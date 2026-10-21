import { projectSettingsGuard } from '@/server/settings-version'
import type { ApiMutationAdmission } from '@/server/api/admission'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import type { aliases, environments } from '@/server/db/schema'

export class EnvironmentStateChanged extends Error {
  constructor() {
    super('Project environments changed. Retry the update.')
  }
}

function isSnapshotFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (
    'message' in error &&
    typeof error.message === 'string' &&
    /NOT NULL constraint failed: projects\.updated_at/i.test(error.message)
  )
    return true
  return 'cause' in error && isSnapshotFailure(error.cause)
}

export async function replaceProjectEnvironments(
  store: AtomicStore,
  input: {
    projectId: string
    previousDefaultServerId: string | null
    defaultServerId?: string | null
    previousEnvironments: Array<typeof environments.$inferSelect>
    previousAliases: Array<typeof aliases.$inferSelect>
    environments: Array<{
      id: string
      name: string
      slug: string
      branch: string
      serverId: string | null
      color: string
      position: number
      isProduction: boolean
      runtimeId: string
      alias: { id: string; hostname: string; https: boolean } | null
    }>
    now: Date
    admission?: ApiMutationAdmission
    settingsVersion?: number
    userId?: string
  },
) {
  const order = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const expectedEnvironments = JSON.stringify(
    order(input.previousEnvironments).map((e) => [
      e.id,
      e.name,
      e.slug,
      e.branch,
      e.serverId,
      e.color,
      e.status,
      Number(e.isProduction),
      e.position,
      e.runtimeId,
      e.updatedAt.getTime(),
    ]),
  )
  const expectedAliases = JSON.stringify(
    order(input.previousAliases.filter((a) => a.type === 'environment')).map(
      (a) => [
        a.id,
        a.environmentId,
        a.hostname,
        a.type,
        a.branch,
        Number(a.https),
      ],
    ),
  )
  const now = input.now.getTime()
  const removed = JSON.stringify(
    input.previousEnvironments
      .filter(
        (e) => !input.environments.some((candidate) => candidate.id === e.id),
      )
      .map((e) => e.id),
  )
  const writes = input.environments.flatMap((e) => {
    const previousAlias = input.previousAliases.find(
      (a) => a.type === 'environment' && a.environmentId === e.id,
    )
    const mutations = [
      store.run(sql`insert into environments
      (id, project_id, name, slug, branch, server_id, color, status, is_production, position, runtime_id, updated_at)
      values (${e.id}, ${input.projectId}, ${e.name}, ${e.slug}, ${e.branch}, ${e.serverId},
        ${e.color}, 'active', ${Number(e.isProduction)}, ${e.position}, ${e.runtimeId}, ${now})
      on conflict(id) do update set
        project_id = case when environments.project_id = excluded.project_id then environments.project_id else null end,
        name = excluded.name, slug = excluded.slug, branch = excluded.branch, server_id = excluded.server_id,
        color = excluded.color, status = 'active', is_production = excluded.is_production,
        position = excluded.position, updated_at = excluded.updated_at`),
    ]
    if (e.alias && !previousAlias)
      mutations.push(
        store.run(sql`insert into aliases
      (id, project_id, environment_id, hostname, type, https, updated_at)
      values (${e.alias.id}, ${input.projectId}, ${e.id},
        case when exists(select 1 from domains where hostname = ${e.alias.hostname}) then null else ${e.alias.hostname} end,
        'environment', ${Number(e.alias.https)}, ${now})`),
      )
    else if (
      e.alias &&
      previousAlias &&
      e.alias.hostname !== previousAlias.hostname
    )
      mutations.push(
        store.run(sql`update aliases set hostname =
        case when exists(select 1 from domains where hostname = ${e.alias.hostname}) then null else ${e.alias.hostname} end,
        https = ${Number(e.alias.https)}, updated_at = ${now} where id = ${previousAlias.id}`),
      )
    else if (!e.alias && previousAlias)
      mutations.push(
        store.run(sql`delete from aliases where id = ${previousAlias.id}`),
      )
    return mutations
  })
  try {
    await store.batch([
      // Fail the whole batch if the snapshot used to reconcile IDs and generate
      // hostnames has changed. The service reloads and retries, rather than
      // committing a mix of two requests. This works with D1's fixed batches.
      store.run(sql`update projects set settings_version = settings_version + 1, updated_at = case when
        status = 'active' and default_server_id is ${input.previousDefaultServerId}
        and not exists(select 1 from json_each(${JSON.stringify([input.defaultServerId === undefined ? input.previousDefaultServerId : input.defaultServerId, ...input.environments.map((e) => e.serverId)].filter(Boolean))}) as assigned where not exists(select 1 from servers s join projects p on p.team_id = s.team_id where p.id = ${input.projectId} and s.id = assigned.value and s.status <> 'deleted'))
        and ${input.admission?.guard ?? sql`1`} ${input.userId && input.settingsVersion !== undefined ? sql`and ${projectSettingsGuard(input.projectId, input.userId, input.settingsVersion)}` : sql``}
        and (select json_group_array(json_array(id, name, slug, branch, server_id, color, status,
          is_production, position, runtime_id, updated_at)) from
          (select * from environments where project_id = ${input.projectId} order by id)) = ${expectedEnvironments}
        and (select json_group_array(json_array(id, environment_id, hostname, type, branch, https)) from
          (select * from aliases where project_id = ${input.projectId} and type = 'environment' order by id)) = ${expectedAliases}
        then ${now} else null end,
        ${input.defaultServerId === undefined ? sql`` : sql`default_server_id = ${input.defaultServerId},`}
        routes = (select json_group_array(json(value)) from json_each(projects.routes)
          where coalesce(json_extract(value, '$.environmentId'), '') not in (select value from json_each(${removed})))
        where id = ${input.projectId}`),
      ...(input.admission?.statements ?? []),
      ...writes,
      store.run(sql`update environments set status = 'deleted', is_production = 0, updated_at = ${now}
        where project_id = ${input.projectId} and id in (select value from json_each(${removed}))`),
      store.run(sql`delete from aliases where project_id = ${input.projectId}
        and environment_id in (select value from json_each(${removed}))`),
      store.run(sql`delete from domains where project_id = ${input.projectId}
        and environment_id in (select value from json_each(${removed}))`),
    ])
  } catch (error) {
    if (isSnapshotFailure(error)) throw new EnvironmentStateChanged()
    throw error
  }
}
