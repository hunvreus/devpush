import { createHash, randomUUID } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/server/db'
import { environments, projects, runtimeLogs } from '@/server/db/schema'
import { requireAgentServer } from '@/server/servers/service'

export type RuntimeLogLine = {
  runtimeId: string
  service: string
  observedAt: string
  content: string
}

const maxRuntimeLogLines = 500
const maxRuntimeLogContentLength = 16_384

export async function recordRuntimeLogs({
  serverId,
  token,
  logs,
}: {
  serverId: string
  token: string
  logs: Array<RuntimeLogLine>
}) {
  await requireAgentServer({ serverId, token })

  const normalizedLogs = normalizeRuntimeLogs(logs)

  if (normalizedLogs.length === 0) {
    return { ok: true, inserted: 0 }
  }

  const allowedRuntimeIds = await listAllowedRuntimeIds({
    serverId,
    runtimeIds: Array.from(new Set(normalizedLogs.map((log) => log.runtimeId))),
  })
  const rows = normalizedLogs
    .filter((log) => allowedRuntimeIds.has(log.runtimeId))
    .map((log) => ({
      id: randomUUID(),
      serverId,
      runtimeId: log.runtimeId,
      service: log.service,
      observedAt: log.observedAt,
      content: log.content,
      contentHash: hashRuntimeLogLine({
        runtimeId: log.runtimeId,
        service: log.service,
        observedAt: log.observedAt,
        content: log.content,
      }),
    }))

  if (rows.length === 0) {
    return { ok: true, inserted: 0 }
  }

  const inserted = await db
    .insert(runtimeLogs)
    .values(rows)
    .onConflictDoNothing({
      target: [
        runtimeLogs.serverId,
        runtimeLogs.runtimeId,
        runtimeLogs.contentHash,
      ],
    })
    .returning({ id: runtimeLogs.id })

  return { ok: true, inserted: inserted.length }
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

async function listAllowedRuntimeIds({
  serverId,
  runtimeIds,
}: {
  serverId: string
  runtimeIds: Array<string>
}) {
  if (runtimeIds.length === 0) {
    return new Set<string>()
  }

  const rows = await db
    .select({ runtimeId: environments.runtimeId })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(environments.serverId, serverId),
        eq(projects.status, 'active'),
        inArray(environments.runtimeId, runtimeIds),
      ),
    )

  return new Set(rows.map((row) => row.runtimeId))
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
