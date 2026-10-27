import { sql } from 'drizzle-orm'
import { PublicError } from '#devpush/lib/public-error'
import type { SQL } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'

export function projectSettingsGuard(
  projectId: string,
  userId: string,
  settingsVersion: number,
  manager = false,
): SQL {
  return sql`exists(select 1 from projects p join teams t on t.id = p.team_id join team_members m on m.team_id = t.id join user u on u.id = m.user_id where p.id = ${projectId} and p.status = 'active' and p.settings_version = ${settingsVersion} and t.status = 'active' and u.status = 'active' and m.user_id = ${userId} ${manager ? sql`and m.role in ('owner','admin')` : sql``})`
}

export function teamSettingsAccess(teamId: string, userId: string): SQL {
  return sql`exists(select 1 from teams t join team_members m on m.team_id = t.id join user u on u.id = m.user_id where t.id = ${teamId} and t.status = 'active' and u.status = 'active' and m.user_id = ${userId} and m.role in ('owner','admin'))`
}

/** A failed guard violates NOT NULL, rolling back every statement in a D1 batch. */
export function advanceProjectSettings(
  store: AtomicStore,
  projectId: string,
  guard: SQL,
) {
  return store.run(
    sql`update projects set settings_version = case when ${guard} then settings_version + 1 else null end where id = ${projectId}`,
  )
}

export function rethrowSettingsConflict(error: unknown): never {
  if (error && typeof error === 'object') {
    if (
      'message' in error &&
      typeof error.message === 'string' &&
      /NOT NULL constraint failed: (projects|teams|user|servers|backup_configs|backup_storage)\.settings_version/i.test(
        error.message,
      )
    )
      throw new PublicError('SETTINGS_CONFLICT')
    if ('cause' in error && error.cause) rethrowSettingsConflict(error.cause)
  }
  throw error
}
