import { createRequire } from 'node:module'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

if (process.env.DEVPUSH_DATABASE_URL || process.env.DEVPUSH_LOG_DATABASE_URL) {
  throw new Error(
    'The local backup profile does not back up remote libSQL databases. Use your database provider backup/export tooling for both stores.',
  )
}

const require = createRequire(
  new URL('../.output/server/index.mjs', import.meta.url),
)
const Sqlite = require('better-sqlite3')
const directory = process.env.DEVPUSH_DB_BACKUP_DIR || '/backups'
const days = Number(process.env.BACKUP_RETENTION_DAYS || 7)
if (!Number.isInteger(days) || days < 1)
  throw new Error('Invalid backup retention days.')
const paths = [
  process.env.DEVPUSH_DATABASE_PATH,
  process.env.DEVPUSH_LOG_DATABASE_PATH,
]
if (paths.some((path) => !path) || resolve(paths[0]) === resolve(paths[1])) {
  throw new Error('Two distinct database paths are required.')
}
await mkdir(directory, { recursive: true })
const stamp = new Date().toISOString().replaceAll(':', '-')
// Each snapshot is consistent; the pair is not a cross-database transaction.
for (const [index, path] of paths.entries()) {
  const connection = new Sqlite(path, { readonly: true, fileMustExist: true })
  const name = `${index === 0 ? 'devpush' : 'logs'}-${stamp}.sqlite`
  const pending = join(directory, `${name}.pending`)
  try {
    await connection.backup(pending)
    const { rename } = await import('node:fs/promises')
    await rename(pending, join(directory, name))
  } finally {
    connection.close()
    await rm(pending, { force: true })
  }
}
for (const name of await readdir(directory)) {
  if (!/^(devpush|logs)-\d{4}-.*\.sqlite$/.test(name)) continue
  const path = join(directory, name)
  if ((await stat(path)).mtimeMs < Date.now() - days * 86400000) await rm(path)
}
console.log('Both SQLite snapshots completed.')
