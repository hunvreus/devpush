import { and, eq, inArray, isNotNull } from 'drizzle-orm'

import type { db } from '@/server/db'
import { agentJobs, deployments, environments, projects } from '@/server/db/schema'

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type DeprovisionJobPayload = {
  schemaVersion: 1
  runtimeIds: Array<string>
  removeVolumes: boolean
  reason: string
}

export const cleanupVolumeRetentionMs = 7 * 24 * 60 * 60 * 1000

type RuntimeTarget = {
  runtimeId: string
  serverId: string
}

export async function enqueueProjectDeprovisionJobs(
  tx: DbTransaction,
  {
    projectId,
    teamId,
    reason,
  }: {
    projectId: string
    teamId: string
    reason: string
  },
) {
  const runtimes = await listProjectRuntimeTargets(tx, projectId)

  await enqueueRuntimeCleanupJobs(tx, {
    projectId,
    teamId,
    reason,
    runtimes,
    includePurge: true,
  })
}

export async function enqueueTeamDeprovisionJobs(
  tx: DbTransaction,
  {
    teamId,
    reason,
  }: {
    teamId: string
    reason: string
  },
) {
  const runtimes = await listTeamRuntimeTargets(tx, teamId)

  await enqueueRuntimeCleanupJobs(tx, {
    teamId,
    reason,
    runtimes,
    includePurge: true,
  })
}

async function listProjectRuntimeTargets(
  tx: DbTransaction,
  projectId: string,
): Promise<Array<RuntimeTarget>> {
  const environmentRows = await tx
    .select({
      runtimeId: environments.runtimeId,
      serverId: environments.serverId,
    })
    .from(environments)
    .where(and(eq(environments.projectId, projectId), isNotNull(environments.serverId)))
  const deploymentRows = await tx
    .select({
      runtimeId: deployments.runtimeId,
      serverId: deployments.serverId,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(eq(environments.projectId, projectId))

  return dedupeRuntimeTargets([
    ...environmentRows
      .filter((row): row is { runtimeId: string; serverId: string } =>
        Boolean(row.serverId),
      )
      .map((row) => ({
        runtimeId: row.runtimeId,
        serverId: row.serverId,
      })),
    ...deploymentRows,
  ])
}

async function listTeamRuntimeTargets(
  tx: DbTransaction,
  teamId: string,
): Promise<Array<RuntimeTarget>> {
  const projectRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.teamId, teamId))
  const projectIds = projectRows.map((row) => row.id)

  if (projectIds.length === 0) {
    return []
  }

  const environmentRows = await tx
    .select({
      runtimeId: environments.runtimeId,
      serverId: environments.serverId,
    })
    .from(environments)
    .where(
      and(inArray(environments.projectId, projectIds), isNotNull(environments.serverId)),
    )
  const deploymentRows = await tx
    .select({
      runtimeId: deployments.runtimeId,
      serverId: deployments.serverId,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(inArray(environments.projectId, projectIds))

  return dedupeRuntimeTargets([
    ...environmentRows
      .filter((row): row is { runtimeId: string; serverId: string } =>
        Boolean(row.serverId),
      )
      .map((row) => ({
        runtimeId: row.runtimeId,
        serverId: row.serverId,
      })),
    ...deploymentRows,
  ])
}

export async function enqueueRuntimeCleanupJobs(
  tx: DbTransaction,
  {
    projectId,
    teamId,
    reason,
    runtimes,
    includePurge,
  }: {
    projectId?: string
    teamId?: string
    reason: string
    runtimes: Array<RuntimeTarget>
    includePurge: boolean
  },
) {
  const runtimeIdsByServer = groupRuntimeIdsByServer(runtimes)

  if (runtimeIdsByServer.size === 0) {
    return []
  }

  const now = new Date()
  const purgeAvailableAt = new Date(now.getTime() + cleanupVolumeRetentionMs)
  const rows = Array.from(runtimeIdsByServer.entries()).flatMap(
    ([serverId, runtimeIds]) => {
      const sortedRuntimeIds = Array.from(runtimeIds).sort()

      const deprovisionJob = {
        id: crypto.randomUUID(),
        type: 'deprovision' as const,
        status: 'queued' as const,
        serverId,
        teamId,
        projectId,
        payload: {
          schemaVersion: 1,
          runtimeIds: sortedRuntimeIds,
          removeVolumes: false,
          reason,
        } satisfies DeprovisionJobPayload,
        maxAttempts: 10,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      }

      if (!includePurge) {
        return [deprovisionJob]
      }

      return [
        deprovisionJob,
        {
          id: crypto.randomUUID(),
          type: 'purge' as const,
          status: 'queued' as const,
          serverId,
          teamId,
          projectId,
          payload: {
            schemaVersion: 1,
            runtimeIds: sortedRuntimeIds,
            removeVolumes: true,
            reason: `${reason} Purge retained volumes after the retention window.`,
          } satisfies DeprovisionJobPayload,
          maxAttempts: 10,
          availableAt: purgeAvailableAt,
          createdAt: now,
          updatedAt: now,
        },
      ]
    },
  )

  return tx.insert(agentJobs).values(rows).returning({ id: agentJobs.id })
}

export async function enqueueRuntimePurgeJobs(
  tx: DbTransaction,
  {
    projectId,
    teamId,
    reason,
    runtimes,
  }: {
    projectId?: string
    teamId?: string
    reason: string
    runtimes: Array<RuntimeTarget>
  },
) {
  const runtimeIdsByServer = groupRuntimeIdsByServer(runtimes)

  if (runtimeIdsByServer.size === 0) {
    return []
  }

  const now = new Date()
  const rows = Array.from(runtimeIdsByServer.entries()).map(
    ([serverId, runtimeIds]) => ({
      id: crypto.randomUUID(),
      type: 'purge' as const,
      status: 'queued' as const,
      serverId,
      teamId,
      projectId,
      payload: {
        schemaVersion: 1,
        runtimeIds: Array.from(runtimeIds).sort(),
        removeVolumes: true,
        reason,
      } satisfies DeprovisionJobPayload,
      maxAttempts: 10,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  )

  return tx.insert(agentJobs).values(rows).returning({ id: agentJobs.id })
}

function dedupeRuntimeTargets(
  runtimes: Array<RuntimeTarget>,
): Array<RuntimeTarget> {
  const seen = new Set<string>()
  const result: Array<RuntimeTarget> = []

  for (const runtime of runtimes) {
    const key = `${runtime.serverId}:${runtime.runtimeId}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(runtime)
  }

  return result
}

function groupRuntimeIdsByServer(runtimes: Array<RuntimeTarget>) {
  const runtimeIdsByServer = new Map<string, Set<string>>()

  for (const runtime of runtimes) {
    const runtimeId = runtime.runtimeId.trim()
    const serverId = runtime.serverId.trim()

    if (!runtimeId || !serverId) {
      continue
    }

    const runtimeIds = runtimeIdsByServer.get(serverId) ?? new Set<string>()
    runtimeIds.add(runtimeId)
    runtimeIdsByServer.set(serverId, runtimeIds)
  }

  return runtimeIdsByServer
}
