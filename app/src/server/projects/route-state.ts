import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { domains, projects } from '@/server/db/schema'
import type { ProjectRoute } from './types'

export async function replaceProjectRoutes(
  store: AtomicStore,
  input: { projectId: string; routes: ProjectRoute[]; now: Date },
) {
  const routes = JSON.stringify(input.routes)
  await store.batch([
    store.run(
      sql`update ${projects} set routes = ${routes}, updated_at = ${input.now.getTime()} where id = ${input.projectId}`,
    ),
    store.run(sql`update ${domains} set base_path = null, updated_at = ${input.now.getTime()}
      where project_id = ${input.projectId} and base_path is not null and base_path <> ''
      and not exists(select 1 from json_each(${routes}) as route
        where json_extract(route.value, '$.path') = ${domains.basePath}
          and (coalesce(json_extract(route.value, '$.environmentId'), '') = ''
            or json_extract(route.value, '$.environmentId') = ${domains.environmentId}))`),
  ])
}
