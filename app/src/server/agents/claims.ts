import { and, eq, sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from '@/server/db/schema'
import { isUniqueConstraintError } from '@/server/db/errors'
import type { AtomicStore } from '@/server/db/atomic'

type Store = Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'update'>

export async function claimDeployment(
  store: Store,
  serverId: string,
  now: Date,
) {
  const { deployments } = schema
  const runtimeAvailable = sql`not exists(select 1 from ${deployments} as running
    where running.runtime_id = ${deployments.runtimeId} and running.status = 'running')`
  try {
    const [claimed] = await store
      .update(deployments)
      .set({ status: 'running', phase: 'agent_connected', startedAt: now })
      .where(
        and(
          eq(deployments.status, 'queued'),
          runtimeAvailable,
          sql`${deployments.id} = (select id from ${deployments}
          where server_id = ${serverId} and status = 'queued' and ${runtimeAvailable}
          order by created_at, id limit 1)`,
        ),
      )
      .returning()
    return claimed ?? null
  } catch (error) {
    if (isUniqueConstraintError(error)) return null
    throw error
  }
}

export async function claimCleanup(store: Store, serverId: string, now: Date) {
  const { agentJobs } = schema
  const [claimed] = await store
    .update(agentJobs)
    .set({
      status: 'running',
      attempt: sql`${agentJobs.attempt} + 1`,
      claimedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentJobs.status, 'queued'),
        sql`${agentJobs.id} = (select id from ${agentJobs} where server_id = ${serverId}
        and type in ('deprovision', 'purge') and status = 'queued' and available_at <= ${now.getTime()}
        order by created_at, id limit 1)`,
      ),
    )
    .returning()
  return claimed ?? null
}

export async function claimBackupCandidate(
  store: Store & Pick<AtomicStore, 'batch'>,
  input: {
    job: typeof schema.agentJobs.$inferSelect
    backupRunId: string | null
    now: Date
  },
) {
  const { agentJobs, backupRuns } = schema
  const guard = and(
    eq(agentJobs.id, input.job.id),
    eq(agentJobs.serverId, input.job.serverId),
    eq(agentJobs.status, 'queued'),
    eq(agentJobs.type, input.job.type),
    eq(agentJobs.payload, input.job.payload),
    sql`${agentJobs.availableAt} <= ${input.now.getTime()}`,
  )
  const claim = store
    .update(agentJobs)
    .set({
      status: 'running',
      attempt: sql`${agentJobs.attempt} + 1`,
      claimedAt: input.now,
      updatedAt: input.now,
    })
    .where(guard)
    .returning()
  if (input.backupRunId) {
    const [, [claimed]] = await store.batch([
      store
        .update(backupRuns)
        .set({ status: 'running', startedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(backupRuns.id, input.backupRunId),
            eq(backupRuns.status, 'queued'),
            sql`exists(select 1 from ${agentJobs} where ${guard})`,
          ),
        ),
      claim,
    ])
    return claimed ?? null
  }
  const [claimed] = await claim
  return claimed ?? null
}
