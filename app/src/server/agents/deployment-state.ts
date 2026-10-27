import { and, eq, or, sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { AtomicStore } from '#devpush/server/db/atomic'
import { deployments, deploymentEvents } from '#devpush/server/db/schema'
import * as schema from '#devpush/server/db/schema'

export async function finishDeployment(
  store: Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'update'> &
    Pick<AtomicStore, 'batch'>,
  input: {
    deployment: typeof deployments.$inferSelect
    projectId: string
    status: 'succeeded' | 'failed' | 'canceled'
    phase: string
    gitSha: string
    errorMessage: string | null
    now: Date
  },
) {
  const { aliases } = schema
  const scope = and(
    eq(deployments.id, input.deployment.id),
    eq(deployments.serverId, input.deployment.serverId),
    eq(deployments.status, 'running'),
  )
  const finish = store
    .update(deployments)
    .set({
      status: input.status,
      phase: input.phase,
      gitSha: input.gitSha,
      errorMessage: input.errorMessage,
      finishedAt: input.now,
    })
    .where(scope)
    .returning({ id: deployments.id })
  if (input.status !== 'succeeded') return (await finish).length === 1
  // Move aliases while the guarded deployment is still running, then finish
  // it in the same batch. A terminal retry cannot move an alias a second time.
  const [, completed] = await store.batch([
    store
      .update(aliases)
      .set({
        previousDeploymentId: sql`${aliases.deploymentId}`,
        deploymentId: input.deployment.id,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(aliases.projectId, input.projectId),
          eq(aliases.environmentId, input.deployment.environmentId),
          or(
            eq(aliases.type, 'environment'),
            and(
              eq(aliases.type, 'branch'),
              eq(aliases.branch, input.deployment.gitBranch),
            ),
          ),
          sql`exists(select 1 from ${deployments} where ${scope})`,
        ),
      ),
    finish,
  ])
  return completed.length === 1
}

export async function failRunningDeployments(
  store: AtomicStore,
  input: {
    ids: string[]
    message: string
    phase: string
    now: Date
    startedBefore?: Date
    heartbeatBefore?: Date
  },
) {
  const failedIds: string[] = []
  for (let offset = 0; offset < input.ids.length; offset += 80) {
    const ids = input.ids.slice(offset, offset + 80)
    const guard = sql`${deployments.id} in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
      and ${deployments.status} = 'running'
      ${input.startedBefore ? sql`and ${deployments.startedAt} < ${input.startedBefore.getTime()}` : sql``}
      ${
        input.heartbeatBefore
          ? sql`and exists(select 1 from servers where servers.id = ${deployments.serverId}
        and (servers.last_seen_at is null or servers.last_seen_at < ${input.heartbeatBefore.getTime()}))`
          : sql``
      }`
    const [, changed] = await store.batch([
      store.run(sql`insert into ${deploymentEvents} (deployment_id, stream, seq, content, search_content, created_at)
        select ${deployments.id}, 'control', coalesce((select max(event.seq) from ${deploymentEvents} as event
          where event.deployment_id = ${deployments.id} and event.stream = 'control'), 0) + 1,
          ${input.message}, ${input.message.toLowerCase()}, ${input.now.getTime()}
        from ${deployments} where ${guard}`),
      store.all(sql`update ${deployments} set status = 'failed', phase = ${input.phase}, error_message = ${input.message},
        finished_at = ${input.now.getTime()} where ${guard} returning id`),
    ])
    // Raw SQLite proxy results are arrays; D1 returns named objects. Normalize
    // only this raw SQL boundary, without relying on either driver's shape.
    for (const row of changed) {
      const id = Array.isArray(row)
        ? row[0]
        : typeof row === 'object' && row !== null && 'id' in row
          ? row.id
          : undefined
      if (typeof id !== 'string')
        throw new Error('Invalid deployment mutation result.')
      failedIds.push(id)
    }
  }
  return failedIds
}
