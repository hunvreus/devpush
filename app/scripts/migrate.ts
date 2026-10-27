import { migrateNode } from '../src/package/migrate'
import { fileURLToPath } from 'node:url'

// Both this source script and Docker's .maintenance bundle are one level below app.
await migrateNode(process.env, {
  migrationsDirectory: fileURLToPath(
    new URL('../src/server/db', import.meta.url),
  ),
})
