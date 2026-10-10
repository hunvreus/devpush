import { readFileSync } from 'node:fs'
import Sqlite from 'better-sqlite3'
import { expect, test } from 'vitest'

test('engine migration preserves order and pauses unknown commands without losing their text', () => {
  const db = new Sqlite(':memory:')
  try {
    db.exec(
      'CREATE TABLE backup_configs(id TEXT, enabled INTEGER, database_dumps TEXT); CREATE TABLE backup_runs(id TEXT, manifest TEXT); CREATE TABLE agent_jobs(type TEXT, payload TEXT);',
    )
    const targets = [
      { service: 'db', command: 'pg_dumpall -U "$POSTGRES_USER"' },
      { service: 'custom', command: 'my-backup --secret example' },
    ]
    db.prepare('INSERT INTO backup_configs VALUES(?,1,?)').run(
      'policy',
      JSON.stringify(targets),
    )
    db.prepare('INSERT INTO backup_runs VALUES(?,?)').run(
      'run',
      JSON.stringify({ existing: true }),
    )
    db.prepare('INSERT INTO agent_jobs VALUES(?,?)').run(
      'backup',
      JSON.stringify({ backupRunId: 'run', databaseDumps: targets }),
    )
    db.exec(
      readFileSync(
        new URL(
          './migrations-sqlite/0006_backup_database_engines.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const policy = db.prepare('SELECT * FROM backup_configs').get() as {
      enabled: number
      database_dumps: string
    }
    expect(policy.enabled).toBe(0)
    const converted = JSON.parse(policy.database_dumps)
    expect(converted).toEqual([
      { service: 'db', engine: 'postgres', database: '' },
      {
        service: 'custom',
        engine: 'needs_configuration',
        database: '',
        legacyCommand: targets[1]!.command,
      },
    ])
    const manifest = JSON.parse(
      (
        db.prepare('SELECT manifest FROM backup_runs').get() as {
          manifest: string
        }
      ).manifest,
    )
    expect(manifest).toEqual({ existing: true, databaseTargets: converted })
    db.exec(
      readFileSync(
        new URL(
          './migrations-sqlite/0007_legacy_postgres_restore.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const historical = JSON.parse(
      (
        db.prepare('SELECT manifest FROM backup_runs').get() as {
          manifest: string
        }
      ).manifest,
    )
    expect(historical.databaseTargets[0]).toEqual({
      service: 'db',
      engine: 'needs_configuration',
      database: '',
      legacyCommand: targets[0].command,
    })
    expect(
      JSON.parse(
        (
          db.prepare('SELECT database_dumps FROM backup_configs').get() as {
            database_dumps: string
          }
        ).database_dumps,
      )[0].engine,
    ).toBe('postgres')
  } finally {
    db.close()
  }
})
