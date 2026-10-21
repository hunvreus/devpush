import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/server/db'
import { servers, teams, teamMembers, user } from '@/server/db/schema'
import type { DeploymentContext } from './contract'

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

export const deploymentContext: DeploymentContext = {
  async readWorkspace(teamId) {
    const rows = await db
      .select({
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        status: teams.status,
        serverCount: sql<number>`(select count(*) from servers s where s.team_id=${teamId} and s.status <> 'deleted')`,
        memberCount: sql<number>`(select count(*) from team_members m join user u on u.id=m.user_id where m.team_id=${teamId} and u.status='active')`,
      })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
    return rows[0] ?? null
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
