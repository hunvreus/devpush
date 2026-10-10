import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import { migrateSqliteFile } from '@/server/db/migrate-sqlite'

const path = join(tmpdir(), `devpush-test-${randomUUID()}.sqlite`)
process.env.DEVPUSH_DATABASE_PATH = path
process.env.DEVPUSH_LOG_DATABASE_PATH = path + '.logs'
migrateSqliteFile(
  path,
  fileURLToPath(new URL('../server/db/migrations-sqlite', import.meta.url)),
)
migrateSqliteFile(
  path + '.logs',
  fileURLToPath(new URL('../server/db/migrations-logs', import.meta.url)),
)
afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '.logs', '.logs-wal', '.logs-shm'])
    rmSync(path + suffix, { force: true })
})
