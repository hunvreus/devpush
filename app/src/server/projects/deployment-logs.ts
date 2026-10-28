import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db, logsDb } from '#devpush/server/db'
import { deploymentLogs } from '#devpush/server/db/log-schema'
import { deployments, environments } from '#devpush/server/db/schema'

type Filters = {
  projectId: string
  branch?: string | null
  deploymentId?: string | null
  environmentId?: string | null
  keyword?: string | null
  since?: Date | null
}
type Line = {
  deploymentId: string
  stream: string
  seq: number
  content: string
  createdAt: Date
}

// Call after main-project authorization. Denormalized identity filters the
// large store; main lookups exclude output whose deployment has been removed.
async function readOutput(filters: Filters, limit: number) {
  const conditions: SQL[] = [eq(deploymentLogs.projectId, filters.projectId)]
  if (filters.branch) conditions.push(eq(deploymentLogs.branch, filters.branch))
  if (filters.deploymentId)
    conditions.push(eq(deploymentLogs.deploymentId, filters.deploymentId))
  if (filters.environmentId)
    conditions.push(eq(deploymentLogs.environmentId, filters.environmentId))
  if (filters.keyword)
    conditions.push(
      like(deploymentLogs.searchContent, `%${filters.keyword.toLowerCase()}%`),
    )
  if (filters.since)
    conditions.push(gte(deploymentLogs.createdAt, filters.since))
  const output: Line[] = []
  let cursor: SQL | undefined
  const pageSize = Math.min(200, Math.max(32, limit))
  while (output.length < limit) {
    const candidates = await logsDb
      .select({
        deploymentId: deploymentLogs.deploymentId,
        stream: deploymentLogs.stream,
        seq: deploymentLogs.seq,
        content: deploymentLogs.content,
        createdAt: deploymentLogs.createdAt,
      })
      .from(deploymentLogs)
      .where(and(...conditions, cursor))
      .orderBy(
        desc(deploymentLogs.createdAt),
        desc(deploymentLogs.deploymentId),
        desc(deploymentLogs.stream),
        desc(deploymentLogs.seq),
      )
      .limit(pageSize)
    if (!candidates.length) break
    const ids = [...new Set(candidates.map((line) => line.deploymentId))]
    const live = new Set<string>()
    for (let offset = 0; offset < ids.length; offset += 80) {
      const rows = await db
        .select({ id: deployments.id })
        .from(deployments)
        .innerJoin(environments, eq(environments.id, deployments.environmentId))
        .where(
          and(
            eq(environments.projectId, filters.projectId),
            inArray(deployments.id, ids.slice(offset, offset + 80)),
            filters.branch
              ? eq(deployments.gitBranch, filters.branch)
              : undefined,
            filters.environmentId
              ? eq(deployments.environmentId, filters.environmentId)
              : undefined,
          ),
        )
      for (const row of rows) live.add(row.id)
    }
    output.push(...candidates.filter((line) => live.has(line.deploymentId)))
    if (candidates.length < pageSize) break
    const last = candidates[candidates.length - 1]
    if (!last) break
    cursor = sql`(${deploymentLogs.createdAt}, ${deploymentLogs.deploymentId}, ${deploymentLogs.stream}, ${deploymentLogs.seq}) < (${last.createdAt}, ${last.deploymentId}, ${last.stream}, ${last.seq})`
  }
  return output.slice(0, limit)
}

export async function readProjectDeploymentLogs(filters: Filters, limit = 200) {
  return readOutput(filters, limit)
}

export async function projectHasDeploymentLogs(projectId: string) {
  return (await readOutput({ projectId }, 1)).length > 0
}
