import type { WorkspaceAdmission } from '#devpush/server/plugins/workspace-access'
import { PublicError } from '#devpush/lib/public-error'
import { getPluginServices } from '#devpush/server/plugins/services.server'
import {
  withWorkspaceAccess,
  requireWorkspaceAdmission,
} from '#devpush/server/plugins/workspace-access'
import { pluginContext } from '#devpush/server/plugins/server-context'
import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import type { deployments } from '#devpush/server/db/schema'
import type { ApiMutationAdmission } from '#devpush/server/api/admission'

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
    canceledMessage: string
    now: Date
    failureMessage?: string
    workspaceAdmission?: WorkspaceAdmission
    admission?: ApiMutationAdmission
  },
) {
  const d = input.deployment
  const now = input.now.getTime()
  const created = sql`exists(select 1 from deployments where id = ${d.id})`
  const active = sql`environment_id = ${d.environmentId} and id <> ${d.id}
    and status in ('queued', 'running') and ${created} and ${!input.failureMessage}`
  const alias = (type: 'deployment' | 'branch', hostname: string) =>
    store.run(sql`insert into aliases
      (id, project_id, environment_id, deployment_id, hostname, type, branch, https, updated_at)
      select ${crypto.randomUUID()}, ${input.projectId}, ${d.environmentId},
        ${type === 'deployment' ? d.id : null},
        case when exists(select 1 from domains where hostname = ${hostname}) then null else ${hostname} end,
        ${type}, ${type === 'branch' ? d.gitBranch : null}, ${Number(input.https)}, ${now}
      where ${created} and ${!input.failureMessage} ${
        type === 'branch'
          ? sql`and not exists(select 1 from aliases
        where project_id = ${input.projectId} and environment_id = ${d.environmentId}
          and type = 'branch' and branch = ${d.gitBranch})`
          : sql``
      }`)

  const action = async () =>
    store.batch([
      store.all(sql`insert into deployments
      (id, environment_id, server_id, status, phase, trigger, github_delivery_id,
       repo_id, repo_full_name, git_sha, git_branch, commit_meta, config, env_vars,
       runtime_id, created_by_user_id, created_at, error_message, finished_at)
      select ${d.id}, ${d.environmentId}, ${d.serverId}, ${input.failureMessage ? 'failed' : 'queued'}, ${input.failureMessage ? 'failed' : 'queued'}, ${d.trigger},
        ${d.githubDeliveryId ?? null}, ${d.repoId}, ${d.repoFullName}, ${d.gitSha}, ${d.gitBranch},
        ${JSON.stringify(d.commitMeta)}, ${JSON.stringify(d.config)}, ${d.envVars}, ${d.runtimeId},
        ${d.createdByUserId ?? null}, ${now}, ${input.failureMessage ?? null}, ${input.failureMessage ? now : null}
      where ${created} or (
        exists(select 1 from environments e join projects p on p.id = e.project_id
          join servers s on s.id = ${d.serverId}
          where e.id = ${d.environmentId} and p.id = ${input.projectId}
            and e.status = 'active' and p.status = 'active' and s.status <> 'deleted'
            and coalesce(e.server_id,p.default_server_id) = ${d.serverId})
        ${input.admission ? sql`and exists(select 1 from environments e join projects p on p.id = e.project_id where e.id = ${d.environmentId} and coalesce(e.server_id,p.default_server_id) = ${d.serverId} and e.runtime_id = ${d.runtimeId} and p.github_repo_id = ${d.repoId})` : sql``}
        and (${d.githubDeliveryId ?? null} is null or not exists(select 1 from deployments
          where github_delivery_id = ${d.githubDeliveryId ?? null} and environment_id = ${d.environmentId}))
        and ${input.admission?.guard ?? sql`1`}
      ) returning id`),
      // Insert before cancellation, so a duplicate delivery skips every effect.
      // A reused deployment ID deliberately fails its primary key instead of
      // letting the following statements operate on an older deployment.
      store.run(sql`update deployments set status = 'canceled', phase = 'canceled',
      error_message = ${input.canceledMessage}, finished_at = ${now} where ${active}`),
      ...(input.branchHostname ? [alias('branch', input.branchHostname)] : []),
      alias('deployment', input.hostname),
      ...(input.admission?.statements ?? []),
    ])
  const access = getPluginServices().workspaceAccess
    ? await pluginContext.readServer(d.serverId)
    : null
  if (getPluginServices().workspaceAccess && !access && !input.failureMessage)
    throw new PublicError('SERVER_NOT_FOUND')
  if (input.workspaceAdmission)
    requireWorkspaceAdmission(
      input.workspaceAdmission,
      access?.teamId ?? input.workspaceAdmission.teamId,
      'deployment.create',
    )
  const [inserted] =
    input.failureMessage || input.workspaceAdmission || !access
      ? await action()
      : await withWorkspaceAccess(
          access.teamId,
          'deployment.create',
          action,
          d.createdByUserId
            ? { kind: 'user', userId: d.createdByUserId }
            : { kind: 'system', source: 'github.push' },
        )
  return inserted.length === 1
}
