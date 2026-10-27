import { and, desc, eq, gte, like, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db, logsDb } from '#devpush/server/db'
import { runtimeLogs } from '#devpush/server/db/log-schema'
import { environments, projects } from '#devpush/server/db/schema'

type Filters = {
  projectId: string
  branch?: string | null
  environmentId?: string | null
  keyword?: string | null
  since?: Date | null
}

// Call only after project authorization. Current assignments stay authoritative:
// moving a runtime to another server hides its previous server's output.
async function runtimeScopes({ projectId, branch, environmentId }: Filters) {
  const conditions = [eq(environments.projectId, projectId)]
  if (branch) conditions.push(eq(environments.branch, branch))
  if (environmentId) conditions.push(eq(environments.id, environmentId))
  const rows = await db
    .select({
      environmentId: environments.id,
      runtimeId: environments.runtimeId,
      serverId: sql<
        string | null
      >`coalesce(${environments.serverId}, ${projects.defaultServerId})`,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(and(...conditions))
  return rows.flatMap((row) =>
    row.serverId
      ? [
          and(
            eq(runtimeLogs.environmentId, row.environmentId),
            eq(runtimeLogs.runtimeId, row.runtimeId),
            eq(runtimeLogs.serverId, row.serverId),
          )!,
        ]
      : [],
  )
}

export async function readProjectRuntimeLogs(filters: Filters) {
  const scopes = await runtimeScopes(filters)
  const conditions: Array<SQL> = [eq(runtimeLogs.projectId, filters.projectId)]
  if (filters.keyword) {
    conditions.push(
      like(runtimeLogs.searchContent, `%${filters.keyword.toLowerCase()}%`),
    )
  }
  if (filters.since) conditions.push(gte(runtimeLogs.observedAt, filters.since))
  const rows: Array<{
    runtimeId: string
    service: string
    content: string
    createdAt: Date
  }> = []
  for (let offset = 0; offset < scopes.length; offset += 20) {
    rows.push(
      ...(await logsDb
        .select({
          runtimeId: runtimeLogs.runtimeId,
          service: runtimeLogs.service,
          content: runtimeLogs.content,
          createdAt: runtimeLogs.observedAt,
        })
        .from(runtimeLogs)
        .where(and(...conditions, or(...scopes.slice(offset, offset + 20))))
        .orderBy(desc(runtimeLogs.observedAt), desc(runtimeLogs.id))
        .limit(200)),
    )
  }
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 200)
}

export async function projectHasRuntimeLogs(projectId: string) {
  const scopes = await runtimeScopes({ projectId })
  for (let offset = 0; offset < scopes.length; offset += 20) {
    const rows = await logsDb
      .select({ id: runtimeLogs.id })
      .from(runtimeLogs)
      .where(
        and(
          eq(runtimeLogs.projectId, projectId),
          or(...scopes.slice(offset, offset + 20)),
        ),
      )
      .limit(1)
    if (rows.length > 0) return true
  }
  return false
}
