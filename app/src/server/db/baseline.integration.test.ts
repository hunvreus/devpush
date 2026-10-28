import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTableName, is, sql, Table } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createD1TestStores } from '#devpush/test/d1'
import type { AtomicStore } from './atomic'
import { migrateSqliteFile } from './migrate-sqlite'
import { openSqlite } from './sqlite-connection'
import * as schema from './schema'
import * as logSchema from './log-schema'

const temporary = mkdtempSync(join(tmpdir(), 'devpush-baseline-'))
const main = openSqlite(join(temporary, 'main.sqlite'), schema)
const logs = openSqlite(join(temporary, 'logs.sqlite'), logSchema)
let d1: Awaited<ReturnType<typeof createD1TestStores>> | undefined

beforeAll(async () => {
  for (const [filename, folder] of [
    ['main.sqlite', 'migrations-sqlite'],
    ['logs.sqlite', 'migrations-logs'],
  ] as const) {
    const directory = fileURLToPath(new URL(`./${folder}/`, import.meta.url))
    const journal = JSON.parse(
      readFileSync(join(directory, 'meta/_journal.json'), 'utf8'),
    )
    expect(journal.entries[0].tag).toBe('0000_initial')
    expect(
      readdirSync(directory)
        .filter((name) => name.endsWith('.sql'))
        .sort(),
    ).toEqual(
      journal.entries.map((entry: { tag: string }) => `${entry.tag}.sql`),
    )
    migrateSqliteFile(join(temporary, filename), directory)
    migrateSqliteFile(join(temporary, filename), directory)
  }
  d1 = await createD1TestStores()
}, 30_000)
afterAll(async () => {
  main.close()
  logs.close()
  await d1?.runtime.dispose()
  rmSync(temporary, { recursive: true, force: true })
})
async function rows(store: AtomicStore, query: ReturnType<typeof sql>) {
  return (await store.all(query)).map((row) =>
    Array.isArray(row) ? row : Object.values(row as Record<string, unknown>),
  )
}
const tableNames = (model: Record<string, unknown>) =>
  Object.values(model)
    .filter((value) => is(value, Table))
    .map((value) => getTableName(value))
    .sort()

test.each(['SQLite', 'D1'] as const)(
  '%s uses the covering index for runtime log retention',
  async (target) => {
    const store = target === 'SQLite' ? logs.db : d1?.logs
    if (!store) throw new Error('D1 fixture missing.')
    const plan = await rows(
      store,
      sql`explain query plan
      select id from runtime_logs where server_id = 'server' and runtime_id = 'runtime'
      order by observed_at desc, created_at desc, id desc limit 1000 offset 10000`,
    )
    const details = plan.flat().join(' ')
    expect(details).toContain('runtime_logs_server_runtime_order_idx')
    expect(details).not.toContain('TEMP B-TREE')
  },
)

test.each(['SQLite', 'D1'] as const)(
  'fresh %s baseline includes all main/log models and database guards',
  async (target) => {
    const stores = target === 'SQLite' ? { main: main.db, logs: logs.db } : d1
    if (!stores) throw new Error('D1 fixture missing.')
    for (const [store, model] of [
      [stores.main, schema],
      [stores.logs, logSchema],
    ] as const) {
      expect(
        (
          await rows(
            store,
            sql`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' and name not like '_cf_%' and name <> 'd1_migrations' order by name`,
          )
        ).flat(),
      ).toEqual(tableNames(model))
    }
    expect(
      (
        await rows(
          stores.main,
          sql`select name from sqlite_master where type='trigger' order by name`,
        )
      ).flat(),
    ).toEqual([
      'api_credentials_revoke_inactive_team',
      'api_credentials_revoke_inactive_user',
      'backup_configs_settings_version',
      'backup_configs_storage_insert',
      'backup_configs_storage_update',
      'backup_runs_storage_insert',
      'backup_runs_storage_update',
      'backup_storage_referenced_delete',
      'backup_storage_settings_version',
      'projects_settings_version',
      'servers_settings_version',
      'teams_settings_version',
      'user_settings_version',
    ])
    await stores.main.batch([
      stores.main.run(
        sql`insert into teams(id,name,slug) values('baseline-team','Baseline','baseline-team')`,
      ),
      stores.main.run(
        sql`insert into user(id,name,username,email) values('baseline-user','User','baseline-user','baseline@example.invalid')`,
      ),
      stores.main.run(
        sql`insert into team_members(id,user_id,team_id,role) values('baseline-member','baseline-user','baseline-team','admin')`,
      ),
      stores.main.run(
        sql`insert into api_keys(id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,project_ids,scopes,expires_at) values('baseline-key','baseline-user','baseline-team','baseline-member','Permanent','prefix','hash','admin','read',null,'["projects:read"]',null)`,
      ),
    ])
    expect(
      await rows(
        stores.main,
        sql`select profile_confirmed_at from user where id='baseline-user'`,
      ),
    ).toEqual([[null]])
    expect(
      await rows(
        stores.main,
        sql`select expires_at from api_keys where id='baseline-key'`,
      ),
    ).toEqual([[null]])
    await stores.main.run(
      sql`update teams set name='Changed' where id='baseline-team'`,
    )
    expect(
      await rows(
        stores.main,
        sql`select settings_version from teams where id='baseline-team'`,
      ),
    ).toEqual([[2]])
    await stores.main.run(
      sql`update teams set status='deleted' where id='baseline-team'`,
    )
    expect(
      await rows(
        stores.main,
        sql`select revoked_at is not null from api_keys where id='baseline-key'`,
      ),
    ).toEqual([[1]])
    await stores.main.run(
      sql`update teams set status='active' where id='baseline-team'`,
    )
    expect(
      await rows(
        stores.main,
        sql`select revoked_at is not null from api_keys where id='baseline-key'`,
      ),
    ).toEqual([[1]])
  },
)

test('SQLite migration journals apply each migration once after a second run', async () => {
  for (const [store, count] of [
    [main.db, 2],
    [logs.db, 2],
  ] as const)
    expect(
      await rows(store, sql`select count(*) from __drizzle_migrations`),
    ).toEqual([[count]])
})
