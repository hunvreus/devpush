import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { db, logsDb } from '#devpush/server/db'
import { deploymentLogs } from '#devpush/server/db/log-schema'
import {
  deploymentEvents,
  deployments,
  environments,
} from '#devpush/server/db/schema'

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

function eventConditions(filters: Filters) {
  const conditions = [eq(environments.projectId, filters.projectId)]
  if (filters.branch) conditions.push(eq(deployments.gitBranch, filters.branch))
  if (filters.deploymentId)
    conditions.push(eq(deploymentEvents.deploymentId, filters.deploymentId))
  if (filters.environmentId)
    conditions.push(eq(deployments.environmentId, filters.environmentId))
  if (filters.keyword)
    conditions.push(
      like(
        deploymentEvents.searchContent,
        `%${filters.keyword.toLowerCase()}%`,
      ),
    )
  if (filters.since)
    conditions.push(gte(deploymentEvents.createdAt, filters.since))
  return conditions
}

function readEvents(filters: Filters, limit: number) {
  return db
    .select({
      deploymentId: deploymentEvents.deploymentId,
      stream: deploymentEvents.stream,
      seq: deploymentEvents.seq,
      content: deploymentEvents.content,
      createdAt: deploymentEvents.createdAt,
    })
    .from(deploymentEvents)
    .innerJoin(deployments, eq(deployments.id, deploymentEvents.deploymentId))
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(and(...eventConditions(filters)))
    .orderBy(
      desc(deploymentEvents.createdAt),
      desc(deploymentEvents.deploymentId),
      desc(deploymentEvents.seq),
    )
    .limit(limit)
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
      .limit(Math.min(200, Math.max(32, limit)))
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
    const last = candidates[candidates.length - 1]
    if (!last) break
    cursor = sql`(${deploymentLogs.createdAt}, ${deploymentLogs.deploymentId}, ${deploymentLogs.stream}, ${deploymentLogs.seq}) < (${last.createdAt}, ${last.deploymentId}, ${last.stream}, ${last.seq})`
  }
  return output.slice(0, limit)
}

export async function readProjectDeploymentLogs(filters: Filters, limit = 200) {
  const [events, output] = await Promise.all([
    readEvents(filters, limit),
    readOutput(filters, limit),
  ])
  return [...events, ...output]
    .sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq,
    )
    .slice(0, limit)
}

export async function projectHasDeploymentLogs(projectId: string) {
  const [event, output] = await Promise.all([
    readEvents({ projectId }, 1),
    readOutput({ projectId }, 1),
  ])
  return event.length > 0 || output.length > 0
}
