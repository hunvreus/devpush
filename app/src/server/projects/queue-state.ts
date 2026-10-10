import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import type { deployments } from '@/server/db/schema'

export type QueuedDeployment = Pick<
  typeof deployments.$inferSelect,
  | 'id'
  | 'environmentId'
  | 'serverId'
  | 'trigger'
  | 'repoId'
  | 'repoFullName'
  | 'gitSha'
  | 'gitBranch'
  | 'commitMeta'
  | 'config'
  | 'envVars'
  | 'runtimeId'
> & { createdByUserId?: string | null; githubDeliveryId?: string | null }

export async function enqueueDeployment(
  store: AtomicStore,
  input: {
    deployment: QueuedDeployment
    projectId: string
    hostname: string
    https: boolean
    branchHostname?: string
    queuedMessage: string
    canceledMessage: string
    now: Date
  },
) {
  const d = input.deployment
  const now = input.now.getTime()
  const created = sql`exists(select 1 from deployments where id = ${d.id})`
  const active = sql`environment_id = ${d.environmentId} and id <> ${d.id}
    and status in ('queued', 'running') and ${created}`
  const alias = (type: 'deployment' | 'branch', hostname: string) =>
    store.run(sql`insert into aliases
      (id, project_id, environment_id, deployment_id, hostname, type, branch, https, updated_at)
      select ${crypto.randomUUID()}, ${input.projectId}, ${d.environmentId},
        ${type === 'deployment' ? d.id : null},
        case when exists(select 1 from domains where hostname = ${hostname}) then null else ${hostname} end,
        ${type}, ${type === 'branch' ? d.gitBranch : null}, ${Number(input.https)}, ${now}
      where ${created} ${
        type === 'branch'
          ? sql`and not exists(select 1 from aliases
        where project_id = ${input.projectId} and environment_id = ${d.environmentId}
          and type = 'branch' and branch = ${d.gitBranch})`
          : sql``
      }`)

  const [inserted] = await store.batch([
    store.all(sql`insert into deployments
      (id, environment_id, server_id, status, phase, trigger, github_delivery_id,
       repo_id, repo_full_name, git_sha, git_branch, commit_meta, config, env_vars,
       runtime_id, created_by_user_id, created_at)
      select ${d.id}, ${d.environmentId}, ${d.serverId}, 'queued', 'queued', ${d.trigger},
        ${d.githubDeliveryId ?? null}, ${d.repoId}, ${d.repoFullName}, ${d.gitSha}, ${d.gitBranch},
        ${JSON.stringify(d.commitMeta)}, ${JSON.stringify(d.config)}, ${d.envVars}, ${d.runtimeId},
        ${d.createdByUserId ?? null}, ${now}
      where ${created} or (
        exists(select 1 from environments e join projects p on p.id = e.project_id
          join servers s on s.id = ${d.serverId}
          where e.id = ${d.environmentId} and p.id = ${input.projectId}
            and e.status = 'active' and p.status = 'active' and s.status <> 'deleted')
        and (${d.githubDeliveryId ?? null} is null or not exists(select 1 from deployments
          where github_delivery_id = ${d.githubDeliveryId ?? null} and environment_id = ${d.environmentId}))
      ) returning id`),
    // Insert before cancellation, so a duplicate delivery skips every effect.
    // A reused deployment ID deliberately fails its primary key instead of
    // letting the following statements operate on an older deployment.
    store.run(sql`insert into deployment_events
      (deployment_id, stream, seq, content, search_content, created_at)
      select id, 'control', coalesce((select max(seq) from deployment_events
        where deployment_id = deployments.id), 0) + 1,
        ${input.canceledMessage}, ${input.canceledMessage.toLowerCase()}, ${now}
      from deployments where ${active}`),
    store.run(sql`update deployments set status = 'canceled', phase = 'canceled',
      error_message = ${input.canceledMessage}, finished_at = ${now} where ${active}`),
    store.run(sql`insert into deployment_events
      (deployment_id, stream, seq, content, search_content, created_at)
      select ${d.id}, 'control', 1, ${input.queuedMessage}, ${input.queuedMessage.toLowerCase()}, ${now}
      where ${created}`),
    ...(input.branchHostname ? [alias('branch', input.branchHostname)] : []),
    alias('deployment', input.hostname),
  ])
  return inserted.length === 1
}
