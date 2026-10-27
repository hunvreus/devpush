import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import type { agentJobs } from '#devpush/server/db/schema'
import type { AgentCleanupCompletion } from './protocol'

export async function recoverStaleCleanupJobs(
  store: AtomicStore,
  input: {
    serverId: string
    cleanupJobId?: string
    now: Date
  },
) {
  const now = input.now.getTime()
  const stale = sql`server_id = ${input.serverId} and type in ('deprovision','purge') and status = 'running'
    and (claimed_at is null or claimed_at < ${now - 60 * 60 * 1000})
    ${input.cleanupJobId ? sql`and id <> ${input.cleanupJobId}` : sql``}`
  await store.batch([
    store.run(sql`update agent_jobs set status = 'abandoned', error_message = 'Cleanup stopped reporting after its final attempt.',
      finished_at = ${now},updated_at = ${now} where ${stale} and attempt >= max_attempts`),
    store.run(sql`update agent_jobs set status = 'queued', error_message = 'Cleanup stopped reporting and will be retried.',
      claimed_at = null,available_at = ${now},finished_at = null,updated_at = ${now} where ${stale} and attempt < max_attempts`),
  ])
}

export async function finishContainerCleanup(
  store: AtomicStore,
  input: {
    job: typeof agentJobs.$inferSelect
    completion: AgentCleanupCompletion
    now: Date
  },
) {
  const job = input.job,
    now = input.now.getTime()
  const retry =
    input.completion.status === 'failed' && job.attempt < job.maxAttempts
  const status = retry
    ? 'queued'
    : input.completion.status === 'failed'
      ? 'abandoned'
      : input.completion.status
  const rows = await store.all(sql`update agent_jobs set status = ${status},
    error_message = ${input.completion.status === 'failed' ? (input.completion.message ?? 'Cleanup failed.') : null},
    claimed_at = ${retry ? null : (job.claimedAt?.getTime() ?? null)},
    available_at = ${retry ? now + 60_000 : job.availableAt.getTime()},finished_at = ${retry ? null : now},updated_at = ${now}
    where id = ${job.id} and server_id = ${job.serverId} and type = ${job.type} and type in ('deprovision','purge')
    and status = 'running' and attempt = ${input.completion.attempt} and attempt = ${job.attempt} and claimed_at is ${job.claimedAt?.getTime() ?? null}
    and updated_at = ${job.updatedAt.getTime()} returning id`)
  return rows.length === 1
}
