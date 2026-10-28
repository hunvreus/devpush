import { notificationRows } from './query'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import { config } from '#devpush/server/config'
import {
  notificationIncidents,
  notificationOutbox,
  notificationScanCursors,
  user,
} from '#devpush/server/db/schema'
import type { NotificationCategory } from '#devpush/lib/notification-preferences'
import { readNotificationPreferences } from './preferences'
import {
  renderNotificationEmail,
  sendEmail,
} from '#devpush/server/email/service'

export type OperationalObservation = {
  id: string
  sourceId: string
  teamId: string
  projectId: string | null
  category: NotificationCategory
  failed: boolean
  revision: string
  at: number
  title: string
  message: string
  path: string
  actorId?: string | null
}
export async function observeOperationalNotification(
  input: OperationalObservation,
) {
  const from = config.EMAIL_FROM
  if (!from) return
  const current = await db
    .select()
    .from(notificationIncidents)
    .where(eq(notificationIncidents.id, input.id))
    .limit(1)
  const previous = current[0]
  if (previous && input.at < previous.updatedAt) return
  if (!input.failed && !previous) return
  const revision = previous?.active
    ? previous.revision
    : input.failed
      ? input.revision
      : previous!.revision
  const value = {
    id: input.id,
    sourceId: input.sourceId,
    teamId: input.teamId,
    projectId: input.projectId,
    category: input.category,
    revision,
    active: input.failed,
    actorId: input.failed
      ? (input.actorId ?? previous?.actorId ?? null)
      : (previous?.actorId ?? null),
    title: input.title,
    message: input.message,
    path: input.path,
    updatedAt: input.at,
  }
  // Repeated observations repair any crash between saving the incident and its recipients.
  await db
    .insert(notificationIncidents)
    .values(value)
    .onConflictDoUpdate({
      target: notificationIncidents.id,
      set: value,
      where: sql`${notificationIncidents.updatedAt} <= ${input.at}`,
    })
  const [incident] = await db
    .select()
    .from(notificationIncidents)
    .where(eq(notificationIncidents.id, input.id))
    .limit(1)
  if (
    !incident ||
    incident.revision !== revision ||
    incident.active !== input.failed
  )
    return
  const recipients = input.failed
    ? await notificationRows<{
        id: string
        actor: number
      }>(
        sql`select u.id,case when u.id=${input.actorId ?? incident.actorId ?? ''} then 1 else 0 end as actor from user u join team_members m on m.user_id=u.id
        where m.team_id=${input.teamId} and u.status='active' and (m.role in ('owner','admin') or u.id=${input.actorId ?? incident.actorId ?? ''})`,
        ['id', 'actor'],
      )
    : await notificationRows<{ id: string; actor: number }>(
        sql`select user_id as id,actor from notification_outbox where incident_id=${input.id} and revision=${revision} and recovery=0 and delivered_at is not null`,
        ['id', 'actor'],
      )
  for (const recipient of recipients) {
    const id = createHash('sha256')
      .update(JSON.stringify([input.id, revision, recipient.id, !input.failed]))
      .digest('hex')
    const [existing] = await db
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, id))
      .limit(1)
    if (existing) continue
    const [recipientUser] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, recipient.id))
      .limit(1)
    if (!recipientUser) continue
    const subject = input.failed
      ? incident.title
      : `Recovered: ${incident.title}`
    const message = input.failed
      ? incident.message
      : 'The previously reported issue has been resolved.'
    const url = new URL(incident.path, config.DEVPUSH_BASE_URL).toString()
    const payload = {
      from,
      to: recipientUser.email,
      subject,
      text: `${message}\n\nView details: ${url}`,
      html: await renderNotificationEmail({
        to: recipientUser.email,
        title: subject,
        message,
        action: { label: 'View details', url },
      }),
    }
    await db
      .insert(notificationOutbox)
      .values({
        id,
        payload,
        actor: Boolean(recipient.actor),
        incidentId: input.id,
        revision,
        userId: recipient.id,
        recovery: !input.failed,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
  }
}

async function eligible(
  userId: string,
  incident: typeof notificationIncidents.$inferSelect,
  actor: boolean,
) {
  const [member] = await notificationRows<{
    email: string
  }>(
    sql`select u.email from user u
    join team_members m on m.user_id=u.id join teams t on t.id=m.team_id
    where u.id=${userId} and u.status='active' and t.id=${incident.teamId} and t.status='active'
      and (m.role in ('owner','admin') or ${actor ? 1 : 0}=1)
      and (${incident.projectId} is null or exists(select 1 from projects p where p.id=${incident.projectId} and p.team_id=t.id and p.status='active'))
      and not exists(select 1 from notification_mutes n where n.user_id=u.id and n.team_id=t.id and (n.project_id is null or n.project_id=${incident.projectId})) limit 1`,
    ['email'],
  )
  if (!member) return null
  if (incident.projectId === null) {
    const [server] = await notificationRows<{ id: string }>(
      sql`select id from servers where id=${incident.sourceId} and status in ('connected','disconnected')`,
      ['id'],
    )
    if (!server) return null
  }
  if (
    incident.id.startsWith('deployment:') ||
    incident.id.startsWith('backup:')
  ) {
    const [environment] = await notificationRows<{ id: string }>(
      sql`select id from environments where id=${incident.sourceId} and status='active'`,
      ['id'],
    )
    if (!environment) return null
  }
  const preference = await readNotificationPreferences(userId)
  if (!preference.preferences[incident.category as NotificationCategory])
    return null
  return member.email
}
export async function deliverOperationalNotifications(
  limit = 50,
  initialNow = Date.now(),
) {
  if (!config.EMAIL_FROM || !config.RESEND_API_KEY) return
  const startedAt = Date.now()
  const deadline = Date.now() + 15_000
  for (let index = 0; index < limit && Date.now() < deadline; index++) {
    const now = initialNow + Date.now() - startedAt
    const lease = randomUUID()
    const [row] = await db
      .update(notificationOutbox)
      .set({
        leaseOwner: lease,
        leaseUntil: sql`cast(unixepoch('subsec') * 1000 as integer) + 300000`,
        attempts: sql`${notificationOutbox.attempts}+1`,
      })
      .where(
        sql`${notificationOutbox.id} = (select id from notification_outbox where delivered_at is null and discarded_at is null and failed_at is null and next_attempt_at<=${now} and lease_until<=cast(unixepoch('subsec') * 1000 as integer) order by created_at,id limit 1) and ${notificationOutbox.leaseUntil}<=cast(unixepoch('subsec') * 1000 as integer)`,
      )
      .returning()
    if (!row) break
    const [incident] = await db
      .select()
      .from(notificationIncidents)
      .where(eq(notificationIncidents.id, row.incidentId))
      .limit(1)
    const email =
      incident &&
      incident.revision === row.revision &&
      incident.active !== row.recovery
        ? await eligible(row.userId, incident, row.actor)
        : null
    const ownership = and(
      eq(notificationOutbox.id, row.id),
      eq(notificationOutbox.leaseOwner, lease),
      sql`${notificationOutbox.leaseUntil} > cast(unixepoch('subsec') * 1000 as integer)`,
    )
    if (!incident || !email || email !== row.payload.to) {
      await db
        .update(notificationOutbox)
        .set({ discardedAt: now, leaseOwner: null, leaseUntil: 0 })
        .where(ownership)
      continue
    }
    if (
      row.attempts > 10 ||
      (row.firstAttemptAt !== null && now - row.firstAttemptAt >= 86_400_000)
    ) {
      await db
        .update(notificationOutbox)
        .set({ failedAt: now, leaseOwner: null, leaseUntil: 0 })
        .where(ownership)
      console.error('Notification email needs operator review.', {
        notificationId: row.id,
      })
      continue
    }
    try {
      // Persist the complete provider payload and window before the first call.
      const payload = row.payload
      const held = await db
        .update(notificationOutbox)
        .set({
          payload,
          firstAttemptAt: row.firstAttemptAt ?? now,
        })
        .where(ownership)
        .returning({ id: notificationOutbox.id })
      if (!held.length) continue
      await sendEmail(payload, `notification-${row.id}`)
      await db
        .update(notificationOutbox)
        .set({ deliveredAt: now, leaseOwner: null, leaseUntil: 0 })
        .where(ownership)
    } catch {
      await db
        .update(notificationOutbox)
        .set({
          nextAttemptAt:
            now + Math.min(3_600_000, 60_000 * 2 ** (row.attempts - 1)),
          leaseOwner: null,
          leaseUntil: 0,
        })
        .where(ownership)
      console.warn('Notification email pending; retry persisted.', {
        notificationId: row.id,
      })
    }
  }
}

export async function pruneOperationalNotifications(now = Date.now()) {
  const before = now - 30 * 86_400_000
  await db
    .delete(notificationOutbox)
    .where(
      sql`${notificationOutbox.createdAt}<${before} and exists(select 1 from notification_incidents i where i.id=${notificationOutbox.incidentId} and i.revision<>${notificationOutbox.revision})`,
    )
  await db.delete(notificationIncidents).where(
    sql`${notificationIncidents.updatedAt}<${before} and (${notificationIncidents.active}=0 or ${notificationIncidents.id} like 'restore:%'
 or (${notificationIncidents.projectId} is not null and not exists(select 1 from projects p where p.id=${notificationIncidents.projectId} and p.status='active'))
 or (${notificationIncidents.projectId} is null and not exists(select 1 from servers s where s.id=${notificationIncidents.sourceId} and s.status<>'deleted'))
 or (${notificationIncidents.id} like 'domain:%' and not exists(select 1 from domains d where d.id=${notificationIncidents.sourceId}))
 or ((${notificationIncidents.id} like 'deployment:%' or ${notificationIncidents.id} like 'backup:%') and not exists(select 1 from environments e where e.id=${notificationIncidents.sourceId} and e.status='active')))`,
  )
}

export async function repairOperationalRecipients() {
  const source = 'recipients'
  const [cursor] = await db
    .select()
    .from(notificationScanCursors)
    .where(eq(notificationScanCursors.source, source))
    .limit(1)
  const rows = await db
    .select()
    .from(notificationIncidents)
    .where(sql`${notificationIncidents.id}>${cursor?.afterId ?? ''}`)
    .orderBy(notificationIncidents.id)
    .limit(100)
  for (const incident of rows) {
    if (incident.updatedAt >= Date.now() - 86_400_000)
      await observeOperationalNotification({
        id: incident.id,
        sourceId: incident.sourceId,
        teamId: incident.teamId,
        projectId: incident.projectId,
        category: incident.category as NotificationCategory,
        failed: incident.active,
        revision: incident.revision,
        at: incident.updatedAt,
        title: incident.title,
        message: incident.message,
        path: incident.path,
        actorId: incident.actorId,
      })
  }
  await db
    .insert(notificationScanCursors)
    .values({ source, afterId: rows.length === 100 ? rows.at(-1)!.id : '' })
    .onConflictDoUpdate({
      target: notificationScanCursors.source,
      set: { afterId: rows.length === 100 ? rows.at(-1)!.id : '' },
    })
}
