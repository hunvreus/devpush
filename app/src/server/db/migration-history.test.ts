import { createClient } from '@libsql/client'
import Sqlite from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { migrateLibsql } from './migrate-libsql'
import { migrateSqliteFile } from './migrate-sqlite'

const migrations = fileURLToPath(
  new URL('./migrations-sqlite/', import.meta.url),
)

test.each(['untracked', 'empty', 'retired'])(
  'SQLite refuses unsupported history (%s) without changing stored data',
  (history) => {
    const temporary = mkdtempSync(join(tmpdir(), 'devpush-history-'))
    const path = join(temporary, 'existing.sqlite')
    try {
      const before = new Sqlite(path)
      before.exec(
        "create table marker(value text); insert into marker values('preserved');",
      )
      if (history !== 'untracked')
        before.exec(
          'create table __drizzle_migrations(id integer primary key, hash text not null, created_at numeric)',
        )
      if (history === 'retired')
        before.exec(
          "insert into __drizzle_migrations values(1,'retired-pre-release',1)",
        )
      before.close()
      expect(() => migrateSqliteFile(path, migrations)).toThrow(
        'Database migration history does not match this release',
      )
      const after = new Sqlite(path)
      try {
        expect(after.prepare('select value from marker').get()).toEqual({
          value: 'preserved',
        })
        expect(
          after
            .prepare("select name from sqlite_master where name='user'")
            .get(),
        ).toBeUndefined()
        if (history === 'retired')
          expect(
            after.prepare('select hash from __drizzle_migrations').get(),
          ).toEqual({ hash: 'retired-pre-release' })
      } finally {
        after.close()
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  },
)

test.each(['untracked', 'empty', 'retired'])(
  'libSQL refuses unsupported history (%s) without changing stored data',
  async (history) => {
    const client = createClient({ url: ':memory:' })
    try {
      await client.execute('create table marker(value text)')
      await client.execute("insert into marker values('preserved')")
      if (history !== 'untracked') {
        await client.execute(
          'create table __drizzle_migrations(id integer primary key, hash text not null, created_at numeric)',
        )
      }
      if (history === 'retired')
        await client.execute(
          "insert into __drizzle_migrations values(1,'retired-pre-release',1)",
        )
      await expect(migrateLibsql(client, migrations)).rejects.toThrow(
        'Database migration history does not match this release',
      )
      expect(
        (await client.execute('select value from marker')).rows[0]?.value,
      ).toBe('preserved')
      expect(
        (
          await client.execute(
            "select name from sqlite_master where name='user'",
          )
        ).rows,
      ).toHaveLength(0)
      if (history === 'retired')
        expect(
          (await client.execute('select hash from __drizzle_migrations'))
            .rows[0]?.hash,
        ).toBe('retired-pre-release')
    } finally {
      client.close()
    }
  },
)

test('upgrading removes obsolete installation settings and preserves access rules', async () => {
  const { mkdirSync, writeFileSync, readFileSync, copyFileSync } =
    await import('node:fs')
  const temporary = mkdtempSync(join(tmpdir(), 'devpush-settings-upgrade-'))
  const path = join(temporary, 'main.sqlite')
  const previous = join(temporary, 'previous')
  try {
    mkdirSync(join(previous, 'meta'), { recursive: true })
    const journal = JSON.parse(
      readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'),
    )
    journal.entries = journal.entries.slice(0, 2)
    writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries)
      copyFileSync(
        join(migrations, `${entry.tag}.sql`),
        join(previous, `${entry.tag}.sql`),
      )
    migrateSqliteFile(path, previous)
    const before = new Sqlite(path)
    before.exec(
      "update installation_settings set sign_in_message='Old notice'; insert into allowlist(id,type,value) values('rule','domain','example.com')",
    )
    before.close()
    migrateSqliteFile(path, migrations)
    const after = new Sqlite(path)
    try {
      expect(
        after
          .prepare(
            "select name from sqlite_master where name='installation_settings'",
          )
          .get(),
      ).toBeUndefined()
      expect(after.prepare('select type,value from allowlist').all()).toEqual([
        { type: 'domain', value: 'example.com' },
      ])
    } finally {
      after.close()
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
