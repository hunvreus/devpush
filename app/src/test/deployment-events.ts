import type { db } from '@/server/db'
import { deploymentEvents } from '@/server/db/schema'

type EventStore = Pick<typeof db, 'insert'>
type Event = Omit<typeof deploymentEvents.$inferInsert, 'searchContent'>

export function insertDeploymentEvents(tx: EventStore, input: Event | Event[]) {
  const rows = Array.isArray(input) ? input : [input]
  return tx.insert(deploymentEvents).values(
    rows.map((row) => ({
      ...row,
      stream: 'control',
      searchContent: row.content.toLowerCase(),
    })),
  )
}
