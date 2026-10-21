import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './index'
import type { AtomicStore } from './atomic'
import { createD1TestStores } from '@/test/d1'

let d1: Awaited<ReturnType<typeof createD1TestStores>> | undefined
beforeAll(async () => {
  d1 = await createD1TestStores()
}, 30_000)
afterAll(async () => {
  await d1?.runtime.dispose()
})

async function readRevision(store: AtomicStore, projectId: string) {
  const [row] = await store.all<{ settings_version: number }>(
    sql`select settings_version from projects where id = ${projectId}`,
  )
  return Number(Array.isArray(row) ? row[0] : row?.settings_version)
}

describe.each(['SQLite', 'D1'] as const)(
  'project revisions on %s',
  (target) => {
    test('settings writes advance versions, operational writes do not, and stale replacements fail', async () => {
      const database = target === 'SQLite' ? db : d1?.main
      if (!database) throw new Error('D1 test store was not initialized.')
      const teamId = crypto.randomUUID(),
        projectId = crypto.randomUUID()
      await database.batch([
        database.run(
          sql`insert into teams(id,name,slug) values (${teamId},'Revisions',${teamId})`,
        ),
        database.run(sql`insert into projects(id,name,slug,team_id,github_repo,created_at,updated_at)
        values (${projectId},'Project','project',${teamId},'example/project',1000,1000)`),
      ])
      await database.run(
        sql`update projects set name = 'Browser rename',updated_at = 1000 where id = ${projectId}`,
      )
      expect(await readRevision(database, projectId)).toBe(2)
      await database.run(
        sql`update projects set github_repo = 'example/renamed' where id = ${projectId}`,
      )
      expect(await readRevision(database, projectId)).toBe(3)
      await database.run(
        sql`update projects set routes = '[{"service":"web","port":3000,"path":"/"}]',updated_at = 5000 where id = ${projectId}`,
      )
      expect(await readRevision(database, projectId)).toBe(4)
      await database.run(
        sql`update projects set updated_at = 1000 where id = ${projectId}`,
      )
      expect(await readRevision(database, projectId)).toBe(4)
      const results = await database.batch([
        database.all(
          sql`update projects set name = 'First replacement',updated_at = 5001 where id = ${projectId} and settings_version = 4 returning id`,
        ),
        database.all(
          sql`update projects set name = 'Stale replacement',updated_at = 5001 where id = ${projectId} and settings_version = 4 returning id`,
        ),
      ])
      expect(results[0]).toHaveLength(1)
      expect(results[1]).toHaveLength(0)
      expect(await readRevision(database, projectId)).toBe(5)
    })
  },
)
