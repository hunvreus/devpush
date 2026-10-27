import { and, eq, sql, asc, inArray, gte } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '#devpush/server/auth/better-auth'
import { db, logsDb } from '#devpush/server/db'
import { operationLogs } from '#devpush/server/db/log-schema'
import {
  agentJobs,
  projects,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'
import { requireAgentServer } from '#devpush/server/servers/service'
import { AgentRequestError } from '#devpush/server/agents/protocol'

const retentionMs = 14 * 24 * 60 * 60 * 1000
const maxBytes = 10 * 1024 * 1024
export const operationLogUploadSchema = z.object({
  serverId: z.string().min(1),
  token: z.string().min(1),
  jobId: z.string().min(1),
  offset: z.number().int().min(0).max(maxBytes),
  content: z
    .string()
    .min(1)
    .max(16 * 1024),
})
export async function uploadOperationLogs(
  payload: z.infer<typeof operationLogUploadSchema>,
) {
  await requireAgentServer(payload)
  const [job] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.id, payload.jobId),
        eq(agentJobs.serverId, payload.serverId),
        inArray(agentJobs.type, ['backup', 'restore']),
      ),
    )
    .limit(1)
  if (!job)
    throw new AgentRequestError(404, 'Operation not found for this server.')
  const bytes = new TextEncoder().encode(payload.content).length
  if (bytes > 16 * 1024 || payload.offset + bytes > maxBytes)
    throw new AgentRequestError(409, 'Operation log size limit exceeded.')
  const [existing] = await logsDb
    .select()
    .from(operationLogs)
    .where(
      and(
        eq(operationLogs.jobId, job.id),
        eq(operationLogs.offset, payload.offset),
      ),
    )
    .limit(1)
  if (existing && existing.content !== payload.content)
    throw new AgentRequestError(
      409,
      'Operation log replay differs from stored output.',
    )
  if (!existing) {
    const [last] = await logsDb
      .select({
        end: sql<number>`coalesce(max(${operationLogs.offset} + length(cast(${operationLogs.content} as blob))), 0)`,
      })
      .from(operationLogs)
      .where(eq(operationLogs.jobId, job.id))
    if (payload.offset !== Number(last?.end ?? 0))
      throw new AgentRequestError(409, 'Operation log offset is out of order.')
  }
  await logsDb
    .insert(operationLogs)
    .values({ jobId: job.id, offset: payload.offset, content: payload.content })
    .onConflictDoNothing({
      target: [operationLogs.jobId, operationLogs.offset],
    })
  return { ok: true }
}
export async function readOperationLogs(request: Request) {
  const current = await auth.api.getSession({ headers: request.headers })
  if (!current) return new Response('Unauthorized', { status: 401 })
  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const id = url.searchParams.get('id') ?? ''
  const rawOffset = url.searchParams.get('offset') ?? '0'
  const offset = Number(rawOffset)
  if (
    !/^\d+$/.test(rawOffset) ||
    !Number.isSafeInteger(offset) ||
    offset > maxBytes
  )
    return new Response('Invalid log offset', { status: 400 })
  if (type !== 'backup' && type !== 'restore')
    return new Response('Invalid operation', { status: 400 })
  const [job] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .innerJoin(projects, eq(projects.id, agentJobs.projectId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.userId, current.user.id),
        eq(teams.status, 'active'),
        eq(projects.status, 'active'),
        eq(user.status, 'active'),
        eq(agentJobs.type, type),
        type === 'restore'
          ? eq(agentJobs.id, id)
          : sql`json_extract(${agentJobs.payload}, '$.backupRunId') = ${id}`,
      ),
    )
    .limit(1)
  if (!job) return new Response('Operation not found', { status: 404 })
  const rows = await logsDb
    .select({ offset: operationLogs.offset, content: operationLogs.content })
    .from(operationLogs)
    .where(
      and(
        eq(operationLogs.jobId, job.id),
        gte(operationLogs.offset, offset),
        sql`${operationLogs.createdAt} >= ${Date.now() - retentionMs}`,
      ),
    )
    .orderBy(asc(operationLogs.offset))

  const content = rows.map((row) => row.content).join('')
  // Uploads are contiguous; returned cursors are UTF-8 byte offsets at chunk
  // boundaries. Reject arbitrary offsets that would silently skip a chunk.
  if (offset > 0 && rows.length && rows[0]!.offset !== offset)
    return new Response(
      'Log offset is no longer available. Reopen the viewer.',
      { status: 409 },
    )
  return Response.json({
    content,
    nextOffset: rows.length
      ? rows.at(-1)!.offset +
        new TextEncoder().encode(rows.at(-1)!.content).length
      : offset,
  })
}
