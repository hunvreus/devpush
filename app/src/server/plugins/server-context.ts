import { config } from '#devpush/server/config'
import { deferBackgroundTask } from '#devpush/server/runtime/background'
import {
  observeOperationalNotification,
  deliverOperationalNotifications,
} from '#devpush/server/notifications/outbox'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import { getResourceColor } from '#devpush/server/resources/color'
import { servers, teams, teamMembers, user } from '#devpush/server/db/schema'
import {
  renderNotificationEmail,
  sendEmail,
} from '#devpush/server/email/service'
import type { PluginContext } from '#devpush/plugins/contract'

const fields = {
  id: servers.id,
  teamId: servers.teamId,
  teamSlug: teams.slug,
  teamStatus: teams.status,
  handle: servers.handle,
  status: servers.status,
  publicAddress: servers.publicAddress,
  publicIpv4: servers.publicIpv4,
  publicIpv6: servers.publicIpv6,
  agentCapabilities: servers.agentCapabilities,
}

export const pluginContext: PluginContext = {
  defer: deferBackgroundTask,
  async prepareNotification(input) {
    const [recipient] = await db
      .select({ email: user.email })
      .from(user)
      .where(and(eq(user.id, input.userId), eq(user.status, 'active')))
      .limit(1)
    if (!recipient) return null
    if (!config.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured.')
    return {
      from: config.EMAIL_FROM,
      to: recipient.email,
      subject: input.subject,
      text: input.action
        ? `${input.message}\n\n${input.action.label}: ${input.action.url}`
        : input.message,
      html: await renderNotificationEmail({
        to: recipient.email,
        title: input.subject,
        message: input.message,
        action: input.action,
      }),
    }
  },
  async notifyUser(input) {
    const prepared =
      input.prepared ?? (await pluginContext.prepareNotification!(input))
    if (!prepared) return false
    // Never send a queued message to a removed account or an old mailbox. A
    // changed address discards this recipient; it must not mutate a provider key.
    const [recipient] = await db
      .select({ email: user.email })
      .from(user)
      .where(and(eq(user.id, input.userId), eq(user.status, 'active')))
      .limit(1)
    if (!recipient || recipient.email !== prepared.to) return false
    await sendEmail(prepared, input.idempotencyKey)
    return true
  },
  async listWorkspaceOwners(teamId) {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .innerJoin(teamMembers, eq(teamMembers.userId, user.id))
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.role, 'owner'),
          eq(user.status, 'active'),
        ),
      )
    return rows.map((row) => row.id)
  },
  async reportServerIssue(input) {
    const now = Date.now()
    deferBackgroundTask(async () => {
      const [server] = await db
        .select({
          teamId: servers.teamId,
          handle: servers.handle,
          slug: teams.slug,
        })
        .from(servers)
        .innerJoin(teams, eq(teams.id, servers.teamId))
        .where(
          and(
            eq(servers.id, input.serverId),
            sql`${servers.status} in ('connected','disconnected')`,
            eq(teams.status, 'active'),
          ),
        )
        .limit(1)
      if (!server) return
      await observeOperationalNotification({
        id: `extension:${input.serverId}:${input.key}`,
        sourceId: input.serverId,
        teamId: server.teamId,
        projectId: null,
        category: input.category,
        failed: input.active,
        revision: String(now),
        at: now,
        title: input.title,
        message: input.message,
        path: `/${encodeURIComponent(server.slug)}/servers/${encodeURIComponent(input.serverId)}`,
      })
      await deliverOperationalNotifications(5)
    })
  },
  async readWorkspace(teamId) {
    const rows = await db
      .select({
        createdAt: sql<number>`${teams.createdAt}`,
        personalOwnerId: sql<
          string | null
        >`(select u.id from user u where u.default_team_id=${teamId} and u.status='active' limit 1)`,
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        image: teams.avatarPath,
        status: teams.status,
        serverCount: sql<number>`(select count(*) from servers s where s.team_id=${teamId} and s.status <> 'deleted')`,
        serverCountChangedAt: sql<number>`(select coalesce(max(case when s.status='deleted' then s.updated_at else s.created_at end), ${teams.createdAt}) from servers s where s.team_id=${teamId})`,
        memberCount: sql<number>`(select count(*) from team_members m join user u on u.id=m.user_id where m.team_id=${teamId} and u.status='active')`,
      })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
    return rows[0] ? { ...rows[0], color: getResourceColor(rows[0].id) } : null
  },
  async authorizeWorkspace(userId, teamSlug) {
    const rows = await db
      .select({
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        role: teamMembers.role,
      })
      .from(teams)
      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .innerJoin(user, eq(user.id, teamMembers.userId))
      .where(
        and(
          eq(teams.slug, teamSlug),
          eq(teamMembers.userId, userId),
          eq(teams.status, 'active'),
          eq(user.status, 'active'),
        ),
      )
      .limit(1)
    return rows[0] ?? null
  },
  async hasServerRouting(serverId) {
    const rows = await db.all<{ present: number }>(sql`
      select 1 as present from aliases a
      join environments e on e.id = a.environment_id
      join projects p on p.id = a.project_id
      left join deployments d on d.id = a.deployment_id
      left join deployments previous on previous.id = a.previous_deployment_id
      where d.server_id = ${serverId} or previous.server_id = ${serverId}
        or (a.deployment_id is null and coalesce(e.server_id,p.default_server_id) = ${serverId})
      limit 1
    `)
    return rows.length > 0
  },
  async readServer(serverId) {
    const rows = await db
      .select(fields)
      .from(servers)
      .innerJoin(teams, eq(teams.id, servers.teamId))
      .where(eq(servers.id, serverId))
      .limit(1)
    return rows[0] ?? null
  },
  async listServers({ afterId, limit }) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Server page size must be between 1 and 100.')
    return db
      .select(fields)
      .from(servers)
      .innerJoin(teams, eq(teams.id, servers.teamId))
      .where(and(afterId ? gt(servers.id, afterId) : undefined))
      .orderBy(asc(servers.id))
      .limit(limit)
  },
}
