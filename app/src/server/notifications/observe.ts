import { deferBackgroundTask } from '#devpush/server/runtime/background'
import { notificationRows } from './query'
import { eq, sql } from 'drizzle-orm'
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
async function projectSource(id: string) {
  const [row] = await notificationRows<ProjectSource>(
    sql`select p.id,p.team_id as teamId,p.slug,p.name,t.slug as teamSlug from projects p join teams t on t.id=p.team_id where p.id=${id} and p.status='active' and t.status='active'`,
    ['id', 'teamId', 'slug', 'name', 'teamSlug'],
  )
  return row
}
export async function observeProjectNotifications(projectId: string) {
  const p = await projectSource(projectId)
  if (!p) return
  const path = `/${encodeURIComponent(p.teamSlug)}/projects/${encodeURIComponent(p.slug)}`
  const deployments = await notificationRows<{
    id: string
    environmentId: string
    status: string
    finishedAt: number
    actorId: string | null
    commitMeta: string
  }>(
    sql`
    select d.id,d.environment_id as environmentId,d.status,d.finished_at as finishedAt,d.created_by_user_id as actorId,d.commit_meta as commitMeta
    from deployments d join environments e on e.id=d.environment_id where e.project_id=${p.id} and e.status='active'
      and d.status in ('failed','succeeded') and d.id=(select x.id from deployments x where x.environment_id=d.environment_id order by x.created_at desc,x.id desc limit 1)`,
    ['id', 'environmentId', 'status', 'finishedAt', 'actorId', 'commitMeta'],
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
        const linked = await notificationRows<{ userId: string }>(
          sql`select a.user_id as userId from account a join team_members m on m.user_id=a.user_id where a.provider_id='github' and a.account_id=${sender} and m.team_id=${p.teamId}`,
          ['userId'],
        )
        actorId = linked.length === 1 ? linked[0]!.userId : null
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
      message: `A deployment of ${p.name} failed. Open the deployment logs for details.`,
      path: `${path}/deployments/${encodeURIComponent(d.id)}`,
      actorId,
    })
  }
  const backups = await notificationRows<{
    id: string
    environmentId: string
    configId: string | null
    status: string
    finishedAt: number
  }>(
    sql`
    select b.id,b.environment_id as environmentId,b.config_id as configId,b.status,b.finished_at as finishedAt from backup_runs b
    where b.project_id=${p.id} and b.status in ('failed','succeeded') and b.id=(select x.id from backup_runs x where x.environment_id=b.environment_id and coalesce(x.config_id,'')=coalesce(b.config_id,'') order by x.created_at desc,x.id desc limit 1)`,
    ['id', 'environmentId', 'configId', 'status', 'finishedAt'],
  )
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
  const domains = await notificationRows<{
    id: string
    hostname: string
    status: string
    updatedAt: number
  }>(
    sql`select id,hostname,status,updated_at as updatedAt from domains where project_id=${p.id} and status in ('active','failed')`,
    ['id', 'hostname', 'status', 'updatedAt'],
  )
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
  const restores = await notificationRows<{ id: string; finishedAt: number }>(
    sql`select id,finished_at as finishedAt from agent_jobs where project_id=${p.id} and type='restore' and status in ('failed','abandoned') and finished_at>${Date.now() - 86_400_000}`,
    ['id', 'finishedAt'],
  )
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
export async function observeServerNotifications(
  serverId: string,
  now = Date.now(),
) {
  const [s] = await notificationRows<{
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
  }>(
    sql`
    select s.id,s.team_id as teamId,s.name,s.handle,t.slug as teamSlug,s.status,s.last_seen_at as lastSeenAt,
      m.disk_used_bytes as diskUsed,m.disk_total_bytes as diskTotal,m.observed_at as metricAt
    from servers s join teams t on t.id=s.team_id left join server_metrics m on m.id=(select x.id from server_metrics x where x.server_id=s.id order by x.observed_at desc limit 1)
    where s.id=${serverId} and s.status in ('connected','disconnected') and t.status='active'`,
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
    ],
  )
  if (!s || !s.lastSeenAt || now - s.lastSeenAt > 86_400_000) return
  const path = `/${encodeURIComponent(s.teamSlug)}/servers/${encodeURIComponent(s.id)}`
  // A five-minute grace period avoids alerts for short network interruptions.
  const offline = now - s.lastSeenAt >= 300_000
  await observeOperationalNotification({
    id: `server:${s.id}`,
    sourceId: s.id,
    teamId: s.teamId,
    projectId: null,
    category: 'servers',
    failed: offline,
    revision: String(s.lastSeenAt),
    at: now,
    title: `Server disconnected: ${s.name}`,
    message: `${s.name} has not contacted devpush for at least five minutes. Existing applications may still be running.`,
    path,
  })
  if (
    s.metricAt &&
    now - s.metricAt < 300_000 &&
    s.diskTotal &&
    s.diskUsed !== null
  ) {
    const ratio = s.diskUsed / s.diskTotal
    // Recovery hysteresis prevents repeated notifications around the warning threshold.
    if (ratio >= 0.9 || ratio < 0.85)
      await observeOperationalNotification({
        id: `disk:${s.id}`,
        sourceId: s.id,
        teamId: s.teamId,
        projectId: null,
        category: 'servers',
        failed: ratio >= 0.9,
        revision: String(s.metricAt),
        at: now,
        title: `Low disk space: ${s.name}`,
        message: `Disk usage on ${s.name} is at least 90%. Free space to avoid failed deployments and backups.`,
        path,
      })
  }
}
async function scan(source: 'projects' | 'servers') {
  const [cursor] = await db
    .select()
    .from(notificationScanCursors)
    .where(eq(notificationScanCursors.source, source))
    .limit(1)
  const table = sql.identifier(source)
  const rows = await notificationRows<{ id: string }>(
    sql`select id from ${table} where id>${cursor?.afterId ?? ''} and status ${source === 'projects' ? sql`='active'` : sql`in ('connected','disconnected')`} order by id limit 100`,
    ['id'],
  )
  for (const row of rows) {
    if (source === 'projects') await observeProjectNotifications(row.id)
    else await observeServerNotifications(row.id)
    // Advance only after successful observation, so failures are retried.
    await db
      .insert(notificationScanCursors)
      .values({ source, afterId: row.id })
      .onConflictDoUpdate({
        target: notificationScanCursors.source,
        set: { afterId: row.id },
      })
  }
  if (rows.length < 100)
    await db
      .insert(notificationScanCursors)
      .values({ source, afterId: '' })
      .onConflictDoUpdate({
        target: notificationScanCursors.source,
        set: { afterId: '' },
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
export function notifyAfterServerUpdate(serverId: string) {
  if (!config.EMAIL_FROM || !config.RESEND_API_KEY) return
  deferBackgroundTask(async () => {
    try {
      await observeServerNotifications(serverId)
      await deliverOperationalNotifications(5)
    } catch {
      console.warn('Server notification pass deferred to scheduled retry.')
    }
  })
}
