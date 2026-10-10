import { sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { AtomicStore } from '@/server/db/atomic'
import * as schema from '@/server/db/schema'

export async function insertProject(
  store: Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'insert'> &
    AtomicStore,
  input: {
    project: typeof schema.projects.$inferInsert
    environment: typeof schema.environments.$inferInsert
    hostname: string | null
    https: boolean
  },
) {
  await store.batch([
    store.insert(schema.projects).values(input.project),
    store.insert(schema.environments).values(input.environment),
    ...(input.hostname
      ? [
          store.run(sql`insert into aliases
      (id, project_id, environment_id, hostname, type, https)
      values (${crypto.randomUUID()}, ${input.project.id}, ${input.environment.id},
        case when exists(select 1 from domains where hostname = ${input.hostname})
          then null else ${input.hostname} end,
        'environment', ${Number(input.https)})`),
        ]
      : []),
  ])
}
