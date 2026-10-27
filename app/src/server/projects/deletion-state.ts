import { releaseBackupCleanupRuns } from '#devpush/server/backups/queue-state'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import { runtimeCleanupInsert } from '#devpush/server/agents/cleanup'

export async function deleteProjectState(
  store: AtomicStore,
  input: {
    projectId: string
    teamId: string
    userId: string
    removeDeployments: boolean
    now: Date
    admission?: ApiMutationAdmission
  },
) {
  const now = input.now.getTime()
  const guard = sql`exists(select 1 from projects p join teams t on t.id = p.team_id
    join team_members m on m.team_id = t.id join user u on u.id = m.user_id
    where p.id = ${input.projectId} and p.team_id = ${input.teamId} and p.status = 'active'
      and t.status = 'active' and u.status = 'active' and m.user_id = ${input.userId}
      and m.role in ('owner', 'admin')) and ${input.admission?.guard ?? sql`1`}`
  const envIds = sql`select id from environments where project_id = ${input.projectId}`
  const message = 'Canceled because the project was deleted.'
  const results = await store.batch([
    store.run(
      releaseBackupCleanupRuns({
        jobIds: sql`select id from agent_jobs where project_id = ${input.projectId}`,
        guard,
        message,
        now: input.now,
      }),
    ),
    store.run(sql`update agent_jobs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where project_id = ${input.projectId}
      and type in ('deploy', 'backup', 'restore', 'backup_cleanup') and status in ('queued', 'running') and ${guard}`),
    ...(input.removeDeployments
      ? [
          store.run(
            runtimeCleanupInsert({
              projectIds: sql`select id from projects where id = ${input.projectId}`,
              projectId: input.projectId,
              guard,
              reason: 'Project deleted.',
              now: input.now,
            }),
          ),
        ]
      : []),
    store.run(sql`update backup_runs set status = 'canceled', error_message = ${message},
      finished_at = ${now}, updated_at = ${now} where project_id = ${input.projectId}
      and status in ('queued', 'running') and ${guard}`),
    ...(input.removeDeployments
      ? [
          store.run(sql`update environments set status = 'deleted',
      is_production = 0, updated_at = ${now} where project_id = ${input.projectId} and ${guard}`),
        ]
      : []),
    store.run(sql`update deployments set status = 'canceled', phase = 'canceled', error_message = ${message},
      finished_at = ${now} where environment_id in (${envIds}) and status in ('queued', 'running') and ${guard}`),
    // Keep hostname reservations until the agent confirms container removal.
    store.all(sql`update projects set status = 'deleted', updated_at = ${now} where id = ${input.projectId}
      and ${guard} returning id`),
    ...(input.admission?.statements ?? []),
  ])
  const changed = results.at(-1 - (input.admission?.statements.length ?? 0))
  return Array.isArray(changed) && changed.length === 1
}
