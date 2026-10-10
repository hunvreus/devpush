import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

export function assertSeparateSqliteFiles(mainPath: string, logPath: string) {
  // Each :memory: connection owns an independent database.
  if (mainPath === ':memory:' || logPath === ':memory:') return
  let same = canonicalPath(mainPath) === canonicalPath(logPath)
  if (!same && existsSync(mainPath) && existsSync(logPath)) {
    const main = statSync(mainPath)
    const logs = statSync(logPath)
    same = main.dev === logs.dev && main.ino === logs.ino
  }
  if (same) {
    throw new Error(
      'DEVPUSH_DATABASE_PATH and DEVPUSH_LOG_DATABASE_PATH must identify separate SQLite files.',
    )
  }
}

// Resolve existing parent symlinks even before the database files are created.
function canonicalPath(path: string): string {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  return resolve(canonicalPath(parent), basename(absolute))
}
