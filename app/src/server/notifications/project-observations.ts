import { sql } from 'drizzle-orm'
import { notificationRows } from './query'

type Deployment = {
  projectId: string
  id: string
  environmentId: string
  status: string
  finishedAt: number
  actorId: string | null
  commitMeta: string
}
type Backup = {
  projectId: string
  id: string
  environmentId: string
  configId: string | null
  status: string
  finishedAt: number
}
type Domain = {
  projectId: string
  id: string
  hostname: string
  status: string
  updatedAt: number
}
type Restore = { projectId: string; id: string; finishedAt: number }

/** Four source queries per bounded project page, not four per project. */
export async function readProjectObservations(projectIds: string[]) {
  const ids = JSON.stringify(projectIds)
  const cutoff = Date.now() - 86_400_000
  const [deployments, backups, domains, restores] = await Promise.all([
    notificationRows<Deployment>(
      sql`
      select e.project_id as projectId,d.id,d.environment_id as environmentId,d.status,d.finished_at as finishedAt,d.created_by_user_id as actorId,d.commit_meta as commitMeta
      from deployments d join environments e on e.id=d.environment_id
      where e.project_id in (select value from json_each(${ids})) and e.status='active'
        and d.status in ('failed','succeeded') and d.finished_at>=${cutoff}
        and d.id=(select x.id from deployments x where x.environment_id=d.environment_id order by x.created_at desc,x.id desc limit 1)`,
      [
        'projectId',
        'id',
        'environmentId',
        'status',
        'finishedAt',
        'actorId',
        'commitMeta',
      ],
    ),
    notificationRows<Backup>(
      sql`
      select b.project_id as projectId,b.id,b.environment_id as environmentId,b.config_id as configId,b.status,b.finished_at as finishedAt from backup_runs b
      where b.project_id in (select value from json_each(${ids})) and b.status in ('failed','succeeded') and b.finished_at>=${cutoff}
        and b.id=(select x.id from backup_runs x where x.environment_id=b.environment_id and coalesce(x.config_id,'')=coalesce(b.config_id,'') order by x.created_at desc,x.id desc limit 1)`,
      ['projectId', 'id', 'environmentId', 'configId', 'status', 'finishedAt'],
    ),
    notificationRows<Domain>(
      sql`
      select project_id as projectId,id,hostname,status,updated_at as updatedAt from domains
      where project_id in (select value from json_each(${ids})) and status in ('active','failed') and updated_at>=${cutoff}`,
      ['projectId', 'id', 'hostname', 'status', 'updatedAt'],
    ),
    notificationRows<Restore>(
      sql`
      select project_id as projectId,id,finished_at as finishedAt from agent_jobs
      where project_id in (select value from json_each(${ids})) and type='restore'
        and status in ('failed','abandoned') and finished_at>=${cutoff}`,
      ['projectId', 'id', 'finishedAt'],
    ),
  ])
  return {
    deployments,
    backups,
    domains,
    restores,
    actors: new Map<string, string | null>(),
  }
}

export type ProjectObservations = Awaited<
  ReturnType<typeof readProjectObservations>
>
