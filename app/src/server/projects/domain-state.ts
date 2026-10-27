import {
  advanceProjectSettings,
  projectSettingsGuard,
  rethrowSettingsConflict,
} from '#devpush/server/settings-version'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import { aliases, domains } from '#devpush/server/db/schema'

export async function replaceProjectDomains(
  store: AtomicStore,
  input: {
    userId?: string
    settingsVersion?: number
    projectId: string
    now: Date
    domains: Array<{
      host: string
      environmentId: string
      basePath: string | null
      https: boolean
    }>
  },
) {
  const now = input.now.getTime()
  const inserts = []
  for (let offset = 0; offset < input.domains.length; offset += 6) {
    const rows = input.domains.slice(offset, offset + 6).map(
      (domain) => sql`(
      ${crypto.randomUUID()}, ${input.projectId}, ${domain.environmentId},
      case when exists(select 1 from ${aliases} where hostname = ${domain.host}) then null else ${domain.host} end,
      ${domain.basePath}, ${Number(domain.https)}, 'pending', null, null, ${now}, ${now})`,
    )
    // A conflicting alias or another project's hostname violates a NOT NULL
    // constraint and rolls the whole replacement back. Existing verification
    // stays valid only when the hostname still points to the same environment.
    inserts.push(
      store.run(sql`insert into ${domains}
      (id, project_id, environment_id, hostname, base_path, https, status, message, verified_at, created_at, updated_at)
      values ${sql.join(rows, sql`, `)} on conflict(hostname) do update set
      project_id = case when ${domains.projectId} = ${input.projectId} then excluded.project_id else null end,
      status = case when ${domains.environmentId} = excluded.environment_id then ${domains.status} else 'pending' end,
      message = case when ${domains.environmentId} = excluded.environment_id then ${domains.message} else null end,
      verified_at = case when ${domains.environmentId} = excluded.environment_id then ${domains.verifiedAt} else null end,
      environment_id = excluded.environment_id, base_path = excluded.base_path, https = excluded.https,
      updated_at = excluded.updated_at`),
    )
  }
  const remove =
    store.run(sql`delete from ${domains} where project_id = ${input.projectId}
    and hostname not in (select value from json_each(${JSON.stringify(input.domains.map((domain) => domain.host))}))`)
  try {
    await store.batch([
      advanceProjectSettings(
        store,
        input.projectId,
        input.userId && input.settingsVersion !== undefined
          ? projectSettingsGuard(
              input.projectId,
              input.userId,
              input.settingsVersion,
            )
          : sql`1`,
      ),
      ...inserts,
      remove,
    ])
  } catch (error) {
    rethrowSettingsConflict(error)
  }
}
