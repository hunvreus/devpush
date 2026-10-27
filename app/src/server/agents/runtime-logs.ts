import { createHash, randomUUID } from 'node:crypto'

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'

import { db, logsDb } from '#devpush/server/db'
import { runtimeLogs } from '#devpush/server/db/log-schema'
import { deployments, environments, projects } from '#devpush/server/db/schema'
import { getPluginServices } from '#devpush/server/plugins/services.server'
import { admitRuntimeLogs, reserveLogBudget } from '#devpush/server/logs/budget'
import { requireAgentServer } from '#devpush/server/servers/service'
import {
  runtimeLogRetentionMs,
  runtimeLogPruneBatchSize,
} from '#devpush/server/logs/retention'

export type RuntimeLogLine = {
  runtimeId: string
  service: string
  observedAt: string
  content: string
}

const maxRuntimeLogLines = 500
const maxRuntimeLogContentLength = 16_384
const maxRuntimeLogRowsPerRuntime = 10_000

export async function recordRuntimeLogs({
  serverId,
  token,
  logs,
}: {
  serverId: string
  token: string
  logs: Array<RuntimeLogLine>
}) {
  const server = await requireAgentServer({ serverId, token })

  const normalizedLogs = normalizeRuntimeLogs(logs)

  if (normalizedLogs.length === 0) {
    return { ok: true, accepted: 0, inserted: 0 }
  }

  const assignments = await listAllowedRuntimes({
    serverId,
    runtimeIds: Array.from(new Set(normalizedLogs.map((log) => log.runtimeId))),
  })
  let rows = normalizedLogs.flatMap((log) => {
    const assignment = assignments.get(log.runtimeId)
    if (!assignment) return []
    return [
      {
        id: randomUUID(),
        projectId: assignment.projectId,
        environmentId: assignment.environmentId,
        serverId,
        runtimeId: log.runtimeId,
        service: log.service,
        observedAt: new Date(Math.min(log.observedAt.getTime(), Date.now())),
        content: log.content,
        searchContent: log.content.toLowerCase(),
        contentHash: hashRuntimeLogLine(log),
      },
    ]
  })

  if (rows.length === 0) {
    return { ok: true, accepted: 0, inserted: 0 }
  }

  const acknowledged = rows.length
  let dropped = 0
  const limits = getPluginServices().runtimeLogLimits?.(server.teamId)
  if (limits) {
    // Replayed batches must not consume another allowance after their rows were stored.
    const known = new Set<string>()
    for (let start = 0; start < rows.length; start += 80) {
      const existing = await logsDb
        .select({ hash: runtimeLogs.contentHash })
        .from(runtimeLogs)
        .where(
          and(
            eq(runtimeLogs.serverId, serverId),
            inArray(
              runtimeLogs.contentHash,
              rows.slice(start, start + 80).map((row) => row.contentHash),
            ),
          ),
        )
      for (const row of existing) known.add(row.hash)
    }
    rows = rows.filter((row) => {
      if (known.has(row.contentHash)) return false
      known.add(row.contentHash)
      return true
    })
    if (rows.length && !(await admitRuntimeLogs(server.teamId, limits, rows))) {
      dropped = rows.length
      const first = rows[0]!
      rows = []
      // One visible notice per workspace/day. Never block agent delivery on a quota refusal.
      if (
        await reserveLogBudget({
          teamId: server.teamId,
          kind: 'notice',
          amount: 1,
          limit: 1,
          windowMs: 86_400_000,
        })
      ) {
        const content =
          'Runtime log limit reached. Some logs were dropped; collection resumes when the allowance resets. Applications and deployments are unaffected.'
        rows.push({
          ...first,
          id: randomUUID(),
          service: 'devpush',
          content,
          searchContent: content.toLowerCase(),
          observedAt: new Date(),
          contentHash: createHash('sha256')
            .update(
              `log-limit:${server.teamId}:${Math.floor(Date.now() / 86_400_000)}`,
            )
            .digest('hex'),
        })
      }
    }
  }

  // Keep each statement below D1's parameter limit. A partially completed
  // request is safe to replay because each line has a stable content hash.
  let inserted = 0
  for (let offset = 0; offset < rows.length; offset += 32) {
    const statements = []
    for (
      let start = offset;
      start < Math.min(offset + 32, rows.length);
      start += 8
    ) {
      statements.push(
        logsDb
          .insert(runtimeLogs)
          .values(rows.slice(start, Math.min(start + 8, rows.length)))
          .onConflictDoNothing({
            target: [
              runtimeLogs.serverId,
              runtimeLogs.runtimeId,
              runtimeLogs.contentHash,
            ],
          })
          .returning({ id: runtimeLogs.id }),
      )
    }
    const [first, ...rest] = statements
    if (first) {
      const batch = await logsDb.batch([first, ...rest])
      inserted += batch.reduce((count, result) => count + result.length, 0)
    }
  }

  await pruneRuntimeLogs({
    serverId,
    runtimeIds: Array.from(new Set(rows.map((row) => row.runtimeId))),
    now: new Date(),
  })

  return {
    ok: true,
    accepted: acknowledged,
    inserted,
    ...(dropped ? { dropped } : {}),
  }
}

function normalizeRuntimeLogs(logs: Array<RuntimeLogLine>) {
  return logs
    .slice(0, maxRuntimeLogLines)
    .map((log) => {
      const runtimeId = log.runtimeId.trim()
      const service = log.service.trim() || 'runtime'
      const content = log.content.slice(0, maxRuntimeLogContentLength)
      const observedAt = new Date(log.observedAt)

      if (
        runtimeId.length === 0 ||
        runtimeId.length > 128 ||
        service.length > 128 ||
        content.length === 0 ||
        Number.isNaN(observedAt.getTime())
      ) {
        return null
      }

      return {
        runtimeId,
        service,
        observedAt,
        content,
      }
    })
    .filter((log): log is NonNullable<typeof log> => log !== null)
}

async function listAllowedRuntimes({
  serverId,
  runtimeIds,
}: {
  serverId: string
  runtimeIds: Array<string>
}) {
  const assignments = new Map<
    string,
    { projectId: string; environmentId: string }
  >()
  for (let offset = 0; offset < runtimeIds.length; offset += 80) {
    const rows = await db
      .select({
        runtimeId: environments.runtimeId,
        projectId: projects.id,
        environmentId: environments.id,
      })
      .from(environments)
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(
        and(
          eq(
            sql`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
            serverId,
          ),
          eq(environments.status, 'active'),
          eq(projects.status, 'active'),
          inArray(
            environments.runtimeId,
            runtimeIds.slice(offset, offset + 80),
          ),
        ),
      )
    for (const row of rows) assignments.set(row.runtimeId, row)
    // A durable capture can arrive after replacement or project deletion.
    // Historical deployment ownership, never the agent's claim alone, permits
    // delivery from the original server. Existing display/retention guards stay.
    const historical = await db
      .selectDistinct({
        runtimeId: deployments.runtimeId,
        projectId: projects.id,
        environmentId: environments.id,
      })
      .from(deployments)
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(
        and(
          eq(deployments.serverId, serverId),
          inArray(deployments.runtimeId, runtimeIds.slice(offset, offset + 80)),
        ),
      )
    for (const row of historical) {
      if (!assignments.has(row.runtimeId)) assignments.set(row.runtimeId, row)
    }
  }
  return assignments
}

async function pruneRuntimeLogs({
  serverId,
  runtimeIds,
  now,
}: {
  serverId: string
  runtimeIds: Array<string>
  now: Date
}) {
  if (runtimeIds.length === 0) {
    return
  }

  const cutoff = new Date(now.getTime() - runtimeLogRetentionMs)

  for (const runtimeId of runtimeIds) {
    const scope = and(
      eq(runtimeLogs.serverId, serverId),
      eq(runtimeLogs.runtimeId, runtimeId),
    )
    // Bound cleanup work independently of how long the agent was disconnected.
    await logsDb.delete(runtimeLogs).where(
      inArray(
        runtimeLogs.id,
        logsDb
          .select({ id: runtimeLogs.id })
          .from(runtimeLogs)
          .where(and(scope, lt(runtimeLogs.observedAt, cutoff)))
          .orderBy(runtimeLogs.observedAt, runtimeLogs.id)
          .limit(runtimeLogPruneBatchSize),
      ),
    )
    await logsDb
      .delete(runtimeLogs)
      .where(
        inArray(
          runtimeLogs.id,
          logsDb
            .select({ id: runtimeLogs.id })
            .from(runtimeLogs)
            .where(scope)
            .orderBy(
              desc(runtimeLogs.observedAt),
              desc(runtimeLogs.createdAt),
              desc(runtimeLogs.id),
            )
            .offset(maxRuntimeLogRowsPerRuntime)
            .limit(runtimeLogPruneBatchSize),
        ),
      )
  }
}

function hashRuntimeLogLine({
  runtimeId,
  service,
  observedAt,
  content,
}: {
  runtimeId: string
  service: string
  observedAt: Date
  content: string
}) {
  return createHash('sha256')
    .update(runtimeId)
    .update('\0')
    .update(service)
    .update('\0')
    .update(observedAt.toISOString())
    .update('\0')
    .update(content)
    .digest('hex')
}
