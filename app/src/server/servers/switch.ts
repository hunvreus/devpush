import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { config } from '#devpush/server/config'
import { db } from '#devpush/server/db'
import {
  agentJobs,
  deployments,
  environments,
  projects,
  servers,
} from '#devpush/server/db/schema'
import { AgentRequestError } from '#devpush/server/agents/protocol'

function sign(value: string) {
  return createHmac('sha256', config.BETTER_AUTH_SECRET)
    .update(value)
    .digest('hex')
}

export async function switchServerControlPlane(input: {
  serverId: string
  token: string
  action: 'prepare' | 'rollback'
  ticket?: string
}) {
  const hash = createHash('sha256').update(input.token).digest('hex')
  const auth = and(
    eq(servers.id, input.serverId),
    or(
      eq(servers.agentCredentialHash, hash),
      eq(servers.pendingAgentCredentialHash, hash),
    ),
  )
  const now = new Date()
  if (input.action === 'rollback') {
    const [value, signature] = (input.ticket ?? '').split('.')
    if (
      !value ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(sign(value), 'hex'),
      )
    ) {
      throw new AgentRequestError(401, 'Invalid rollback ticket.')
    }
    const ticket = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
      id: string
      at: number
    }
    if (ticket.id !== input.serverId || !Number.isSafeInteger(ticket.at))
      throw new AgentRequestError(401, 'Invalid rollback ticket.')
    const rows = await db
      .update(servers)
      .set({ status: 'connected', updatedAt: now })
      .where(
        and(
          auth,
          eq(servers.status, 'disabled'),
          eq(servers.updatedAt, new Date(ticket.at)),
        ),
      )
      .returning({ id: servers.id })
    if (!rows.length)
      throw new AgentRequestError(
        409,
        'Source state changed; rollback requires operator review.',
      )
    return { serverId: input.serverId }
  }
  // One conditional write both validates emptiness and disables subsequent claims.
  const rows = await db
    .update(servers)
    .set({ status: 'disabled', updatedAt: now })
    .where(
      and(
        auth,
        eq(servers.status, 'connected'),
        sql`not exists (select 1 from ${projects} where ${projects.defaultServerId} = ${input.serverId})`,
        sql`not exists (select 1 from ${environments} where ${environments.serverId} = ${input.serverId})`,
        sql`not exists (select 1 from ${agentJobs} where ${agentJobs.serverId} = ${input.serverId} and ${inArray(agentJobs.status, ['queued', 'running'])})`,
        sql`not exists (select 1 from ${deployments} where ${deployments.serverId} = ${input.serverId})`,
      ),
    )
    .returning({ id: servers.id })
  if (!rows.length)
    throw new AgentRequestError(
      409,
      'Source must be connected and have no projects, deployments, or outstanding jobs.',
    )
  const value = Buffer.from(
    JSON.stringify({ id: input.serverId, at: now.getTime() }),
  ).toString('base64url')
  return { serverId: input.serverId, ticket: `${value}.${sign(value)}` }
}
