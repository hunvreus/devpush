import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Sqlite from 'better-sqlite3'
import { expect, test } from 'vitest'
import { migrateSqliteFile } from './migrate-sqlite'

test('migration promotes identical legacy connections and preserves dispatched backup locations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devpush-storage-migration-'))
  const old = join(directory, 'old')
  mkdirSync(join(old, 'meta'), { recursive: true })
  const migrations = fileURLToPath(
    new URL('./migrations-sqlite', import.meta.url),
  )
  const journal = JSON.parse(
    readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
  )
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx < 3,
  )
  writeFileSync(join(old, 'meta/_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries)
    copyFileSync(
      join(migrations, `${entry.tag}.sql`),
      join(old, `${entry.tag}.sql`),
    )
  const path = join(directory, 'test.sqlite')
  try {
    migrateSqliteFile(path, old)
    const before = new Sqlite(path)
    before.exec(
      "INSERT INTO teams(id,slug,name) VALUES('t','team','Team'); INSERT INTO projects(id,team_id,slug,name,github_repo) VALUES('p','t','project','Project','example/repo'); INSERT INTO environments(id,project_id,name,slug,branch,runtime_id) VALUES('e','p','Production','production','main','runtime'); INSERT INTO servers(id,team_id,handle,name) VALUES('s','t','server','Server');",
    )
    const destination = {
      bucket: 'shared-bucket',
      region: 'auto',
      accessKeyId: 'key',
      secretAccessKeyCiphertext: 'encrypted-value',
      prefix: 'one',
    }
    const insert = before.prepare(
      "INSERT INTO backup_configs(id,name,project_id,environment_id,schedule,destination,retention) VALUES(?,?,'p','e','{\"cron\":\"0 2 * * *\"}',?,'{}')",
    )
    insert.run('a', 'One', JSON.stringify(destination))
    insert.run('b', 'Two', JSON.stringify({ ...destination, prefix: 'two' }))
    before.exec(
      "INSERT INTO backup_runs(id,project_id,environment_id,runtime_id,status,server_id) VALUES('run','p','e','runtime','succeeded','s')",
    )
    before
      .prepare(
        "INSERT INTO agent_jobs(id,type,server_id,project_id,payload) VALUES('job','backup','s','p',?)",
      )
      .run(
        JSON.stringify({
          backupRunId: 'run',
          retention: { remote: { enabled: true } },
          destination: { ...destination, bucket: 'original-bucket' },
        }),
      )
    before.close()
    migrateSqliteFile(path, migrations)
    const after = new Sqlite(path)
    try {
      expect(
        after.prepare('SELECT count(*) AS count FROM backup_storage').get(),
      ).toEqual({ count: 2 })
      const policies = after
        .prepare('SELECT destination FROM backup_configs ORDER BY id')
        .all() as { destination: string }[]
      expect(policies.map((row) => JSON.parse(row.destination))).toEqual([
        { storageId: 'migrated-a', prefix: 'one' },
        { storageId: 'migrated-a', prefix: 'two' },
      ])
      const run = after
        .prepare('SELECT destination, config_id FROM backup_runs')
        .get() as { destination: string; config_id: string | null }
      expect(JSON.parse(run.destination)).toMatchObject({
        bucket: 'original-bucket',
        storageId: 'recovered-run',
      })
      expect(run.config_id).toBeNull() // Ambiguous old policy ownership must not be invented.
    } finally {
      after.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
