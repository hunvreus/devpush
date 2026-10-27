import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'
import {
  buildDatabaseBackupCommand,
  buildDatabaseRestoreCommand,
} from './database-commands'
import {
  backupDatabaseEngines,
  databaseArtifactTarget,
} from '#devpush/lib/backup-database'

test.each(backupDatabaseEngines)(
  '$label generates syntactically valid paired commands',
  ({ value }) => {
    for (const database of ['', "app'; echo injected; #"]) {
      const target = { service: 'db', engine: value, database }
      const backup = buildDatabaseBackupCommand(target)
      const restore = buildDatabaseRestoreCommand(target)
      execFileSync('sh', ['-n', '-c', backup])
      execFileSync('sh', ['-n', '-c', restore])
      expect(backup).not.toContain('| gzip')
      expect(restore).not.toContain('mongodump')
    }
  },
)
test('database names are passed as one literal argument', () => {
  const name = "app'; echo injected; #"
  const command = buildDatabaseBackupCommand({
    service: 'db',
    engine: 'postgres',
    database: name,
  })
  const script = `pg_dump() { printf '%s\\n' "$@"; }; ${command}`
  const args = execFileSync('sh', ['-c', script], { encoding: 'utf8' })
  expect(args.split('\n')).toContain(`--dbname=${name}`)
  expect(args).not.toContain('\ninjected\n')
})
test('unsupported targets cannot generate executable commands', () => {
  expect(() =>
    buildDatabaseBackupCommand({
      service: 'db',
      engine: 'needs_configuration',
      database: '',
    }),
  ).toThrow()
})
test('database artifact lookup uses its original index, service and format', () => {
  const targets = [{ service: 'db', engine: 'mongo' as const, database: 'app' }]
  expect(
    databaseArtifactTarget('prefix/databases/01-db.archive.gz', targets),
  ).toEqual(targets[0])
  expect(
    databaseArtifactTarget('prefix/databases/02-db.archive.gz', targets),
  ).toBeUndefined()
  expect(
    databaseArtifactTarget('prefix/databases/01-db.sql.gz', targets),
  ).toBeUndefined()
})

test.each(['mysql', 'mariadb'] as const)(
  '%s database names cannot become CLI options',
  (engine) => {
    const command = buildDatabaseBackupCommand({
      service: 'db',
      engine,
      database: '--all-databases',
    })
    const executable = engine === 'mysql' ? 'mysqldump' : 'mariadb-dump'
    const script = `capture() { printf '%s\\n' "$@"; }; ${command.replace(executable, 'capture')}`
    const args = execFileSync('sh', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MYSQL_ROOT_PASSWORD: 'test',
        MARIADB_ROOT_PASSWORD: 'test',
      },
    })
      .trim()
      .split('\n')
    expect(args.slice(-3)).toEqual(['--databases', '--', '--all-databases'])
  },
)
