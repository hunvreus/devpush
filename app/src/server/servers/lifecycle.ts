import { releaseBackupCleanupRuns } from '#devpush/server/backups/queue-state'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import {
  serverAvailabilityWindows,
  servers,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'

export async function changeServerEnabled(
  store: AtomicStore,
  input: {
    userId: string
    teamId: string
    serverId: string
    enabled: boolean
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const now = input.now.getTime()
  const mayManage = sql`exists(select 1 from ${teamMembers} as member
    join ${user} as manager on manager.id = member.user_id
    join ${teams} as managed_team on managed_team.id = member.team_id
    where member.team_id = ${input.teamId} and member.user_id = ${input.userId}
      and member.role in ('owner', 'admin') and manager.status = 'active' and managed_team.status = 'active') and ${input.admission?.guard ?? sql`1`}`
  if (input.enabled) {
    // Insert before changing status, so a racing request cannot open a second
    // interval after the first request has already enabled the server.
    const [, changed] = await store.batch([
      store.run(sql`insert into ${serverAvailabilityWindows} (id, server_id, started_at, created_at)
        select ${crypto.randomUUID()}, id, ${now}, ${now} from ${servers}
        where id = ${input.serverId} and team_id = ${input.teamId} and status = 'disabled' and ${mayManage}
        and not exists(select 1 from ${serverAvailabilityWindows} where server_id = ${input.serverId} and ended_at is null)`),
      store.all(sql`update ${servers} set status = 'pending', updated_at = ${now}
        where id = ${input.serverId} and team_id = ${input.teamId} and status = 'disabled' and ${mayManage} returning id`),
      ...(input.admission?.statements ?? []),
    ])
    return changed.length === 1
  }
  const [changed] = await store.batch([
    store.all(sql`update ${servers} set status = 'disabled', enrollment_token_hash = null,
      enrollment_token_expires_at = null, updated_at = ${now}
      where id = ${input.serverId} and team_id = ${input.teamId} and status <> 'deleted' and ${mayManage} returning id`),
    ...(input.admission?.statements ?? []),
    store.run(sql`update ${serverAvailabilityWindows} set ended_at = ${now}
      where server_id = ${input.serverId} and ended_at is null and ${mayManage}
      and exists(select 1 from ${servers} where id = ${input.serverId} and team_id = ${input.teamId} and status = 'disabled')`),
  ])
  return changed.length === 1
}

export async function deleteServerState(
  store: AtomicStore,
  input: {
    userId: string
    teamId: string
    serverId: string
    cancelOngoingDeployments: boolean
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const now = input.now.getTime()
  const guard = sql`exists(select 1 from servers s
    join teams t on t.id = s.team_id
    join team_members m on m.team_id = t.id
    join user u on u.id = m.user_id
    where s.id = ${input.serverId} and s.team_id = ${input.teamId} and s.status <> 'deleted'
      and t.status = 'active' and u.status = 'active'
      and m.user_id = ${input.userId} and m.role in ('owner', 'admin')) and ${input.admission?.guard ?? sql`1`}`
  const message = 'Canceled because the server was deleted.'
  const changes: [
    ReturnType<AtomicStore['run']>,
    ...ReturnType<AtomicStore['run']>[],
  ] = [
    store.run(
      releaseBackupCleanupRuns({
        jobIds: sql`select id from agent_jobs where server_id = ${input.serverId}`,
        guard,
        message,
        now: input.now,
      }),
    ),
    store.run(sql`update agent_jobs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where server_id = ${input.serverId}
      and type in ('backup', 'restore', 'backup_cleanup') and status in ('queued', 'running') and ${guard}`),
    store.run(sql`update backup_runs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where server_id = ${input.serverId}
      and status in ('queued', 'running') and ${guard}`),
  ]
  if (input.cancelOngoingDeployments)
    changes.push(
      store.run(sql`update deployments set status = 'canceled', phase = 'canceled',
      error_message = ${message}, finished_at = ${now} where server_id = ${input.serverId}
      and status in ('queued', 'running') and ${guard}`),
      store.run(sql`update agent_jobs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where server_id = ${input.serverId}
      and type = 'deploy' and status in ('queued', 'running') and ${guard}`),
    )
  const results = await store.batch([
    ...changes,
    store.run(
      sql`delete from server_metrics where server_id = ${input.serverId} and ${guard}`,
    ),
    store.run(
      sql`delete from server_heartbeats where server_id = ${input.serverId} and ${guard}`,
    ),
    store.run(sql`update server_availability_windows set ended_at = ${now}
      where server_id = ${input.serverId} and ended_at is null and ${guard}`),
    store.all(sql`update servers set status = 'deleted', updated_at = ${now}
      ${input.cancelOngoingDeployments ? sql`, enrollment_token_hash = null, enrollment_token_expires_at = null` : sql``}
      where id = ${input.serverId} and ${guard} returning id`),
    ...(input.admission?.statements ?? []),
  ])
  // The optional deployment cancellations change the number of statements.
  const changed = results.at(-1 - (input.admission?.statements.length ?? 0))
  return Array.isArray(changed) && changed.length === 1
}
