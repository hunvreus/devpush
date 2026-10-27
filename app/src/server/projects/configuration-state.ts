import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import type { ProjectRuntimeConfig } from '#devpush/lib/project-runtime-config'
import {
  requireProjectRuntimeConfig,
  hostLifecycleCommandsChanged,
  hostLifecycleCommandsUseChangedSource,
} from '#devpush/lib/project-runtime-config'
import {
  projectSettingsGuard,
  rethrowSettingsConflict,
} from '#devpush/server/settings-version'
import type { ProjectRoute } from './types'

export function invalidDomainBasePathCleanup(
  store: AtomicStore,
  input: {
    projectId: string
    routes: ProjectRoute[]
    now: Date
    guard?: ReturnType<typeof sql>
  },
) {
  return store.run(sql`update domains set base_path = null,updated_at = ${input.now.getTime()}
    where project_id = ${input.projectId} and base_path is not null and base_path <> '' and ${input.guard ?? sql`1`}
    and not exists(select 1 from json_each(${JSON.stringify(input.routes)}) as route
      where json_extract(route.value,'$.path') = domains.base_path
      and (coalesce(json_extract(route.value,'$.environmentId'),'') = '' or json_extract(route.value,'$.environmentId') = domains.environment_id))`)
}

export async function updateProjectRuntimeState(
  store: AtomicStore,
  input: {
    projectId: string
    userId: string
    settingsVersion: number
    currentRuntimeConfig: unknown
    runtimeConfig: ProjectRuntimeConfig
    composeMetadata?: unknown
    routes?: ProjectRoute[]
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const current = requireProjectRuntimeConfig(input.currentRuntimeConfig)
  const manager =
    hostLifecycleCommandsChanged(current, input.runtimeConfig) ||
    hostLifecycleCommandsUseChangedSource({
      currentRepoFullName: '',
      nextRepoFullName: '',
      currentRuntimeConfig: current,
      nextRuntimeConfig: input.runtimeConfig,
    })
  const envIds = [
    ...new Set(
      input.routes?.map((route) => route.environmentId).filter(Boolean) ?? [],
    ),
  ]
  const guard = sql`${projectSettingsGuard(input.projectId, input.userId, input.settingsVersion, manager)}
    and runtime_config = ${JSON.stringify(input.currentRuntimeConfig)} and ${input.admission?.guard ?? sql`1`}
    and not exists(select 1 from json_each(${JSON.stringify(envIds)}) needed
      where not exists(select 1 from environments where id = needed.value and project_id = ${input.projectId} and status = 'active'))`
  const metadata =
    input.composeMetadata === undefined
      ? sql`case when ${current.path} is not ${input.runtimeConfig.path} then null else compose_metadata end`
      : sql`${input.composeMetadata === null ? null : JSON.stringify(input.composeMetadata)}`
  try {
    const [rows] = await store.batch([
      store.all(sql`update projects set settings_version = case when ${guard} then settings_version + 1 else null end,
        runtime_config = ${JSON.stringify(input.runtimeConfig)},compose_metadata = ${metadata},updated_at = ${input.now.getTime()}
        ${input.routes ? sql`, routes = ${JSON.stringify(input.routes)}` : sql``}
        where id = ${input.projectId} and status = 'active' returning id`),
      ...(input.admission?.statements ?? []),
      ...(input.routes
        ? [
            invalidDomainBasePathCleanup(store, {
              projectId: input.projectId,
              routes: input.routes,
              now: input.now,
              guard: sql`${projectSettingsGuard(input.projectId, input.userId, input.settingsVersion + 1, manager)} and ${input.admission?.guard ?? sql`1`}`,
            }),
          ]
        : []),
    ])
    return rows.length === 1
  } catch (error) {
    rethrowSettingsConflict(error)
  }
}
