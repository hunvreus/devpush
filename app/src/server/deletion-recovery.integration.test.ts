import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { openLibsql } from '#devpush/server/db/libsql-connection'
import { afterAll, expect, test } from 'vitest'
import { sql } from 'drizzle-orm'
import { createD1TestStores } from '#devpush/test/d1'
import { closeDb, db } from '#devpush/server/db'
import {
  deletionRecoveryPlan,
  inspectDeletion,
  recoveryRows,
  recoveryTargetQuery,
} from './deletion-recovery'
import {
  pruneDeletedResources,
  deletedResourceRetentionMs,
} from './deleted-resources'
import type { AtomicStore } from './db/atomic'

async function exercise(store: AtomicStore) {
  const prefix = crypto.randomUUID(),
    now = new Date(),
    old = now.getTime() - deletedResourceRetentionMs - 1000
  const t = prefix + 't',
    s = prefix + 's',
    p = prefix + 'p',
    e = prefix + 'e'
  const job = prefix + 'job',
    backup = prefix + 'backup',
    artifact = prefix + 'artifact'
  const input = {
    operator: 'installation-operator',
    reason: 'Host disk destroyed; archive removed at storage provider.',
    now,
  }
  async function row(target: 'project' | 'job' | 'artifact', id: string) {
    return recoveryRows(await store.all(recoveryTargetQuery(target, id)))[0]!
  }
  async function execute(plan: ReturnType<typeof deletionRecoveryPlan>) {
    const [first, ...rest] = plan
    const result = await store.batch([
      store.all(first),
      ...rest.map((query) => store.run(query)),
    ])
    return result[0].length
  }
  try {
    await store.run(
      sql`insert into teams (id,name,slug,status,updated_at) values (${t},'Team',${t},'deleted',${old})`,
    )
    await store.run(
      sql`insert into servers (id,team_id,name,handle,status,updated_at) values (${s},${t},'Server',${s},'deleted',${old})`,
    )
    await store.run(
      sql`insert into projects (id,team_id,name,slug,github_repo,default_server_id,status,updated_at) values (${p},${t},'Project',${p},'owner/repo',${s},'deleted',${old})`,
    )
    await store.run(
      sql`insert into environments (id,project_id,name,slug,branch,runtime_id,status) values (${e},${p},'Production','production','main',${prefix},'active')`,
    )
    await store.run(
      sql`insert into agent_jobs (id,type,server_id,team_id,project_id,status,payload,attempt,available_at,updated_at) values (${job},'purge',${s},${t},${p},'abandoned','{"runtimeIds":["test-runtime"],"destination":{"secret":"must-not-print"}}',10,${now.getTime() + 60000},${old})`,
    )
    const original = await row('job', job)
    const report = JSON.stringify(await inspectDeletion(store, 'job', original))
    expect(report).not.toContain('must-not-print')
    expect(report).toContain('test-runtime')
    const retry = deletionRecoveryPlan({
      ...input,
      action: 'retry-job',
      row: original,
    })
    await expect(
      store.batch([
        store.all(retry[0]),
        store.run(
          sql`insert into teams(id,name,slug) values (${t},'Duplicate',${t})`,
        ),
      ]),
    ).rejects.toThrow()
    expect(
      await store.all(sql`select id from api_audit where resource_id = ${job}`),
    ).toHaveLength(0)
    expect(await execute(retry)).toBe(1)
    expect(await execute(retry)).toBe(0) // A stale command cannot reset a newer attempt.
    let current = await row('job', job)
    expect(current.status).toBe('queued')
    expect(current.attempt).toBe(10)
    expect(current.max_attempts).toBe(20)
    expect(current.available_at).toBe(now.getTime() + 60000)
    await store.run(
      sql`update agent_jobs set status = 'running', claimed_at = ${now.getTime()} where id = ${job}`,
    )
    expect(() =>
      deletionRecoveryPlan({
        ...input,
        action: 'confirm-job',
        row: { ...current, status: 'running', claimed_at: now.getTime() },
      }),
    ).toThrow('running')
    await store.run(
      sql`update agent_jobs set status = 'running', claimed_at = ${old}, updated_at = ${now.getTime() + 1} where id = ${job}`,
    )
    current = await row('job', job)
    expect(
      await execute(
        deletionRecoveryPlan({ ...input, action: 'confirm-job', row: current }),
      ),
    ).toBe(1)
    expect((await row('job', job)).status).toBe('succeeded')
    // Complete the retained project only once, through normal queued jobs.
    const project = await row('project', p)
    const cleanup = deletionRecoveryPlan({
      ...input,
      action: 'cleanup-project',
      row: project,
    })
    expect(await execute(cleanup)).toBe(1)
    expect(await execute(cleanup)).toBe(0)
    expect(
      await store.all(
        sql`select id from agent_jobs where project_id = ${p} and type in ('deprovision','purge')`,
      ),
    ).toHaveLength(3)
    const env = recoveryRows(
      await store.all(
        sql`select json_object('status', status) as record from environments where id = ${e}`,
      ),
    )[0]!
    expect(env.status).toBe('deleted')
    await store.run(
      sql`insert into backup_runs (id,project_id,environment_id,server_id,runtime_id,status,updated_at) values (${backup},${p},${e},${s},'test-runtime','failed',${old})`,
    )
    await store.run(
      sql`insert into backup_artifacts (id,backup_run_id,type,storage,object_key,checksum_sha256,size_bytes) values (${artifact},${backup},'volume','remote','test.tar','sha',1)`,
    )
    const archive = await row('artifact', artifact)
    await store.run(
      sql`update backup_runs set cleanup_queued_at = ${now.getTime()} where id = ${backup}`,
    )
    expect(
      await execute(
        deletionRecoveryPlan({
          ...input,
          action: 'confirm-artifact',
          row: archive,
        }),
      ),
    ).toBe(0)
    await store.run(
      sql`update backup_runs set cleanup_queued_at = null where id = ${backup}`,
    )
    expect(
      await execute(
        deletionRecoveryPlan({
          ...input,
          action: 'confirm-artifact',
          row: archive,
        }),
      ),
    ).toBe(1)
    expect(await row('artifact', artifact)).toBeUndefined()
    // An attempted canceled backup stays blocked until explicitly resolved.
    const bjob = prefix + 'bjob'
    await store.run(
      sql`insert into agent_jobs (id,type,server_id,team_id,project_id,status,payload,attempt,updated_at) values (${bjob},'backup',${s},${t},${p},'canceled',${JSON.stringify({ backupRunId: backup })},1,${old})`,
    )
    expect(() =>
      deletionRecoveryPlan({
        ...input,
        action: 'retry-job',
        row: { ...current, type: 'backup', status: 'canceled' },
      }),
    ).toThrow('Only container')
    expect(
      await execute(
        deletionRecoveryPlan({
          ...input,
          action: 'confirm-job',
          row: await row('job', bjob),
        }),
      ),
    ).toBe(1)
    expect((await row('job', bjob)).status).toBe('canceled')
    expect(String((await row('job', bjob)).payload)).toContain(
      'confirmed-cleanup',
    )
    // Queue receipts still block collection; manual confirmation does not skip retention.
    expect((await pruneDeletedResources({ store, now })).projects).toBe(0)
    const future = new Date(now.getTime() + deletedResourceRetentionMs + 2000)
    await store.run(
      sql`update agent_jobs set status = 'succeeded', finished_at = ${old}, updated_at = ${old} where project_id = ${p} and type in ('deprovision','purge')`,
    )
    await pruneDeletedResources({ store, now: future })
    expect(await row('project', p)).toBeUndefined()
    const audits = await store.all(
      sql`select id from api_audit where resource_id in (${job},${p},${artifact},${bjob})`,
    )
    expect(audits).toHaveLength(5)
  } finally {
    await store.run(sql`delete from agent_jobs where server_id = ${s}`)
    await store.run(sql`delete from projects where id = ${p}`)
    await store.run(sql`delete from servers where id = ${s}`)
    await store.run(sql`delete from teams where id = ${t}`)
    await store.run(
      sql`delete from api_audit where resource_id in (${job},${p},${artifact},${prefix + 'bjob'})`,
    )
  }
}

afterAll(closeDb)
test('operator recovery uses atomic guards on SQLite', () => exercise(db))
test('operator recovery uses atomic guards on D1', async () => {
  const stores = await createD1TestStores()
  try {
    await exercise(stores.main)
  } finally {
    await stores.runtime.dispose()
  }
}, 30000)

test('operator recovery uses atomic guards on libSQL', async () => {
  const client = createClient({ url: 'file::memory:' })
  const connection = openLibsql(client, {})
  try {
    await client.execute('PRAGMA foreign_keys = ON')
    const migration = readFileSync(
      new URL('./db/migrations-sqlite/0000_initial.sql', import.meta.url),
      'utf8',
    )
    for (const statement of migration
      .split('--> statement-breakpoint')
      .filter((value) => value.trim()))
      await client.execute(statement)
    await exercise(connection.db)
  } finally {
    connection.close()
  }
}, 30000)
