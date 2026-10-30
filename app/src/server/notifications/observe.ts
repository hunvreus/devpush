import { readProjectObservations } from './project-observations'
import type { ProjectObservations } from './project-observations'
import { deferBackgroundTask } from '#devpush/server/runtime/background'
import { notificationRows } from './query'
import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import { config } from '#devpush/server/config'
import { notificationScanCursors } from '#devpush/server/db/schema'
import {
  observeOperationalNotification,
  deliverOperationalNotifications,
  repairOperationalRecipients,
} from './outbox'

type ProjectSource = {
  id: string
  teamId: string
  slug: string
  name: string
  teamSlug: string
}
function projectSources(filter: SQL) {
  return notificationRows<ProjectSource>(
    sql`select p.id,p.team_id as teamId,p.slug,p.name,t.slug as teamSlug from projects p join teams t on t.id=p.team_id where ${filter} and p.status='active' and t.status='active' order by p.id limit 100`,
    ['id', 'teamId', 'slug', 'name', 'teamSlug'],
  )
}
export async function observeProjectNotifications(
  projectId: string,
  source?: ProjectSource,
  prefetched?: ProjectObservations,
) {
  const p = source ?? (await projectSources(sql`p.id=${projectId}`))[0]
  if (!p) return
  const path = `/${encodeURIComponent(p.teamSlug)}/projects/${encodeURIComponent(p.slug)}`
  const observations = prefetched ?? (await readProjectObservations([p.id]))
  const deployments = observations.deployments.filter(
    (row) => row.projectId === p.id,
  )
  for (const d of deployments) {
    if (!d.finishedAt || d.finishedAt < Date.now() - 86_400_000) continue
    let actorId = d.actorId
    if (!actorId) {
      let sender: unknown
      try {
        sender = (JSON.parse(d.commitMeta) as { githubSenderId?: unknown })
          .githubSenderId
      } catch {
        sender = null
      }
      if (typeof sender === 'string' && /^\d+$/.test(sender)) {
        const key = `${p.teamId}:${sender}`
        if (!observations.actors.has(key)) {
          const linked = await notificationRows<{ userId: string }>(
            sql`select a.user_id as userId from account a join team_members m on m.user_id=a.user_id where a.provider_id='github' and a.account_id=${sender} and m.team_id=${p.teamId}`,
            ['userId'],
          )
          observations.actors.set(
            key,
            linked.length === 1 ? linked[0]!.userId : null,
          )
        }
        actorId = observations.actors.get(key) ?? null
      }
    }
    await observeOperationalNotification({
      id: `deployment:${d.environmentId}`,
      sourceId: d.environmentId,
      teamId: p.teamId,
      projectId: p.id,
      category: 'deployments',
      failed: d.status === 'failed',
      revision: d.id,
      at: d.finishedAt,
      title: `Deployment failed: ${p.name}`,
      message: `A deployment of ${p.name} failed. Open the deployment details for the reason and any available logs.`,
      path: `${path}/deployments/${encodeURIComponent(d.id)}`,
      actorId,
    })
  }
  const backups = observations.backups.filter((row) => row.projectId === p.id)
  for (const b of backups.filter(
    (backup) =>
      backup.finishedAt && backup.finishedAt >= Date.now() - 86_400_000,
  ))
    await observeOperationalNotification({
      id: `backup:${b.environmentId}:${b.configId ?? 'manual'}`,
      sourceId: b.environmentId,
      teamId: p.teamId,
      projectId: p.id,
      category: 'backups',
      failed: b.status === 'failed',
      revision: b.id,
      at: b.finishedAt,
      title: `Backup failed: ${p.name}`,
      message: `A backup of ${p.name} failed. Check its storage destination and backup details.`,
      path: `${path}/backups`,
    })
  const domains = observations.domains.filter((row) => row.projectId === p.id)
  for (const d of domains.filter(
    (domain) => domain.updatedAt >= Date.now() - 86_400_000,
  ))
    await observeOperationalNotification({
      id: `domain:${d.id}`,
      sourceId: d.id,
      teamId: p.teamId,
      projectId: p.id,
      category: 'domains',
      failed: d.status === 'failed',
      revision: String(d.updatedAt),
      at: d.updatedAt,
      title: `Domain needs attention: ${d.hostname}`,
      message: `Domain verification or HTTPS configuration for ${d.hostname} failed. Open routing settings for details.`,
      path: `${path}/settings#domains`,
    })
  const restores = observations.restores.filter((row) => row.projectId === p.id)
  for (const r of restores)
    await observeOperationalNotification({
      id: `restore:${r.id}`,
      sourceId: r.id,
      teamId: p.teamId,
      projectId: p.id,
      category: 'backups',
      failed: true,
      revision: r.id,
      at: r.finishedAt,
      title: `Restore failed: ${p.name}`,
      message: `A restore of ${p.name} failed and may need manual recovery. Check restore details before making further changes.`,
      path: `${path}/backups`,
    })
}
type ServerSource = {
  id: string
  teamId: string
  name: string
  handle: string
  teamSlug: string
  status: string
  lastSeenAt: number | null
  diskUsed: number | null
  diskTotal: number | null
  metricAt: number | null
  metricId: string | null
}
function serverSources(filter: SQL) {
  return notificationRows<ServerSource>(
    sql`
    select s.id,s.team_id as teamId,s.name,s.handle,t.slug as teamSlug,s.status,s.last_seen_at as lastSeenAt,
      m.disk_used_bytes as diskUsed,m.disk_total_bytes as diskTotal,m.observed_at as metricAt,m.id as metricId
    from servers s join teams t on t.id=s.team_id left join server_metrics m on m.id=(select x.id from server_metrics x where x.server_id=s.id order by x.observed_at desc,x.id desc limit 1)
    where ${filter} and s.status in ('connected','disconnected') and t.status='active' order by s.id limit 100`,
    [
      'id',
      'teamId',
      'name',
      'handle',
      'teamSlug',
      'status',
      'lastSeenAt',
      'diskUsed',
      'diskTotal',
      'metricAt',
      'metricId',
    ],
  )
}
export async function observeServerNotifications(
  serverId: string,
  now = Date.now(),
  source?: ServerSource,
) {
  const s = source ?? (await serverSources(sql`s.id=${serverId}`))[0]
  if (!s || !s.lastSeenAt || now - s.lastSeenAt > 86_400_000) return
  const path = `/${encodeURIComponent(s.teamSlug)}/servers/${encodeURIComponent(s.id)}`
  // A five-minute grace period avoids alerts for short network interruptions.
  const offline = now - s.lastSeenAt >= 300_000
  await observeOperationalNotification(
    {
      id: `server:${s.id}`,
      sourceId: s.id,
      teamId: s.teamId,
      projectId: null,
      category: 'servers',
      failed: offline,
      revision: String(s.lastSeenAt),
      at: offline ? s.lastSeenAt + 300_000 : s.lastSeenAt,
      title: `Server disconnected: ${s.name}`,
      message: `${s.name} has not contacted devpush for at least five minutes. Existing applications may still be running.`,
      path,
    },
    sql`exists(select 1 from servers where id=${s.id} and last_seen_at=${s.lastSeenAt}
    and status in ('connected','disconnected'))`,
  )
  if (
    s.metricAt &&
    now - s.metricAt < 300_000 &&
    s.diskTotal &&
    s.diskUsed !== null
  ) {
    const ratio = s.diskUsed / s.diskTotal
    // Recovery hysteresis prevents repeated notifications around the warning threshold.
    if (ratio >= 0.9 || ratio < 0.85)
      await observeOperationalNotification(
        {
          id: `disk:${s.id}`,
          sourceId: s.id,
          teamId: s.teamId,
          projectId: null,
          category: 'servers',
          failed: ratio >= 0.9,
          revision: String(s.metricAt),
          at: s.metricAt,
          title: `Low disk space: ${s.name}`,
          message: `Disk usage on ${s.name} is at least 90%. Free space to avoid failed deployments and backups.`,
          path,
        },
        sql`${s.metricId} = (select id from server_metrics where server_id=${s.id}
        order by observed_at desc,id desc limit 1)`,
      )
  }
}
async function scan(source: 'projects' | 'servers') {
  const [cursor] = await db
    .select()
    .from(notificationScanCursors)
    .where(eq(notificationScanCursors.source, source))
    .limit(1)
  const rows =
    source === 'projects'
      ? await projectSources(sql`p.id > ${cursor?.afterId ?? ''}`)
      : await serverSources(sql`s.id > ${cursor?.afterId ?? ''}`)
  const observations =
    source === 'projects' && rows.length
      ? await readProjectObservations(rows.map((row) => row.id))
      : undefined
  for (const row of rows) {
    if ('slug' in row)
      await observeProjectNotifications(row.id, row, observations)
    else await observeServerNotifications(row.id, Date.now(), row)
  }
  // Commit once per completed page. A failed page is replayed idempotently.
  const afterId = rows.length === 100 ? rows.at(-1)!.id : ''
  if (afterId !== (cursor?.afterId ?? ''))
    await db
      .insert(notificationScanCursors)
      .values({ source, afterId })
      .onConflictDoUpdate({
        target: notificationScanCursors.source,
        set: { afterId },
        where: sql`${notificationScanCursors.afterId} is not ${afterId}`,
      })
}
export async function maintainOperationalNotifications() {
  if (!config.EMAIL_FROM || !config.RESEND_API_KEY) return
  await Promise.all([scan('projects'), scan('servers')])
  await repairOperationalRecipients()
  await deliverOperationalNotifications()
}
/** Best-effort immediate pass; durable source state and the scheduled scan repair interruptions. */
export function notifyAfterAgentCompletion(serverId: string) {
  if (!config.EMAIL_FROM || !config.RESEND_API_KEY) return
  deferBackgroundTask(async () => {
    try {
      const rows = await notificationRows<{ id: string }>(
        sql`select distinct project_id as id from agent_jobs where server_id=${serverId} and project_id is not null and finished_at>${Date.now() - 60_000} union select distinct e.project_id as id from deployments d join environments e on e.id=d.environment_id where d.server_id=${serverId} and d.finished_at>${Date.now() - 60_000}`,
        ['id'],
      )
      for (const p of rows) await observeProjectNotifications(p.id)
      await deliverOperationalNotifications(10)
    } catch {
      console.warn('Operational notification pass deferred to scheduled retry.')
    }
  })
}

export function notifyAfterProjectUpdate(projectId: string) {
  if (!config.EMAIL_FROM || !config.RESEND_API_KEY) return
  deferBackgroundTask(async () => {
    try {
      await observeProjectNotifications(projectId)
      await deliverOperationalNotifications(10)
    } catch {
      console.warn('Project notification pass deferred to scheduled retry.')
    }
  })
}
