import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { config } from '@/server/config'
import * as schema from './schema'

const pool = new Pool({ connectionString: config.DATABASE_URL })

export const db = drizzle(pool, { schema })

export async function closeDb() {
  await pool.end()
}
