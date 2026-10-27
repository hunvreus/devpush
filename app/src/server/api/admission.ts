import type { SQL } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'

// Domain services commit these statements in the same transaction as their
// effect. The guard is checked by the effect itself, after any provider reads.
export type ApiMutationAdmission = {
  guard: SQL
  statements: ReturnType<AtomicStore['run']>[]
  resourceId: string
  secondaryResourceId?: string
  idempotencyId?: string
}
