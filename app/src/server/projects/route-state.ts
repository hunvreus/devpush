import { invalidDomainBasePathCleanup } from './configuration-state'
import {
  projectSettingsGuard,
  rethrowSettingsConflict,
} from '#devpush/server/settings-version'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import { projects } from '#devpush/server/db/schema'
import type { ProjectRoute } from './types'

export async function replaceProjectRoutes(
  store: AtomicStore,
  input: {
    projectId: string
    userId?: string
    settingsVersion?: number
    routes: ProjectRoute[]
    now: Date
  },
) {
  const routes = JSON.stringify(input.routes)
  try {
    await store.batch([
      store.run(
        sql`update ${projects} set settings_version = case when ${input.userId && input.settingsVersion !== undefined ? projectSettingsGuard(input.projectId, input.userId, input.settingsVersion) : sql`1`} then settings_version + 1 else null end, routes = ${routes}, updated_at = ${input.now.getTime()} where id = ${input.projectId} and status = 'active'`,
      ),
      invalidDomainBasePathCleanup(store, {
        projectId: input.projectId,
        routes: input.routes,
        now: input.now,
        guard: sql`changes() = 1`,
      }),
    ])
  } catch (error) {
    rethrowSettingsConflict(error)
  }
}
