import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'

export async function replacePendingIdentity(
  store: AtomicStore,
  input: {
    identifier: string
    value: string
    expiresAt: Date
  },
) {
  await store.batch([
    store.run(
      sql`delete from verification where identifier = ${input.identifier}`,
    ),
    store.run(sql`insert into verification (id, identifier, value, expires_at)
      values (${crypto.randomUUID()}, ${input.identifier}, ${input.value}, ${input.expiresAt.getTime()})`),
  ])
}
