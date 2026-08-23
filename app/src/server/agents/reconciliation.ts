import { and, eq, inArray, isNull, lte } from 'drizzle-orm'

import { db } from '@/server/db'
import {
  agentJobs,
  agentRuntimeObservations,
  deployments,
  environments,
} from '@/server/db/schema'
import {
  cleanupVolumeRetentionMs,
  enqueueRuntimeCleanupJobs,
  enqueueRuntimePurgeJobs,
} from './cleanup'

const observedRuntimeGraceMs = 10 * 60 * 1000
const maxReportedRuntimeIds = 200
const runtimeIdPrefix = 'dp_'

type ReportedRuntimeService = {
  name: string
  containerName: string
  state: string
  health: string | null
  restartCount: number
  startedAt: string | null
  exitCode: number
}

export type ReportedRuntime = {
  runtimeId: string
  services: Array<ReportedRuntimeService>
}

export async function reconcileReportedRuntimes({
  serverId,
  runtimeIds,
  runtimes = [],
  now = new Date(),
}: {
  serverId: string
  runtimeIds: Array<string>
  runtimes?: Array<ReportedRuntime>
  now?: Date
}) {
  const normalizedRuntimeIds = normalizeRuntimeIds(runtimeIds)

  if (normalizedRuntimeIds.length === 0) {
    return db.transaction((tx) =>
      enqueueRetainedVolumePurgeJobs(tx, { serverId, now }),
    )
  }

  return db.transaction(async (tx) => {
    await recordRuntimeObservations(tx, {
      serverId,
      runtimeIds: normalizedRuntimeIds,
      runtimes,
      now,
    })

    const cutoff = new Date(now.getTime() - observedRuntimeGraceMs)
    const candidates = await tx
      .select({
        id: agentRuntimeObservations.id,
        runtimeId: agentRuntimeObservations.runtimeId,
      })
      .from(agentRuntimeObservations)
      .where(
        and(
          eq(agentRuntimeObservations.serverId, serverId),
          inArray(agentRuntimeObservations.runtimeId, normalizedRuntimeIds),
          lte(agentRuntimeObservations.firstSeenAt, cutoff),
          isNull(agentRuntimeObservations.cleanupQueuedAt),
        ),
      )

    const orphanRuntimeIds =
      candidates.length === 0
        ? []
        : await listOrphanRuntimeIds(tx, {
            serverId,
            runtimeIds: candidates.map((candidate) => candidate.runtimeId),
          })

    if (orphanRuntimeIds.length > 0) {
      await enqueueRuntimeCleanupJobs(tx, {
        reason:
          'devpush detected a Compose runtime that is no longer assigned.',
        runtimes: orphanRuntimeIds.map((runtimeId) => ({
          serverId,
          runtimeId,
        })),
        includePurge: false,
      })

      await tx
        .update(agentRuntimeObservations)
        .set({
          cleanupQueuedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentRuntimeObservations.serverId, serverId),
            inArray(agentRuntimeObservations.runtimeId, orphanRuntimeIds),
          ),
        )
    }

    const purgeRuntimeIds = await enqueueRetainedVolumePurgeJobs(tx, {
      serverId,
      now,
    })

    return [...orphanRuntimeIds, ...purgeRuntimeIds]
  })
}

async function enqueueRetainedVolumePurgeJobs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  {
    serverId,
    now,
  }: {
    serverId: string
    now: Date
  },
) {
  const cutoff = new Date(now.getTime() - cleanupVolumeRetentionMs)
  const candidates = await tx
    .select({
      runtimeId: agentRuntimeObservations.runtimeId,
    })
    .from(agentRuntimeObservations)
    .where(
      and(
        eq(agentRuntimeObservations.serverId, serverId),
        lte(agentRuntimeObservations.cleanupQueuedAt, cutoff),
        isNull(agentRuntimeObservations.purgeQueuedAt),
      ),
    )

  if (candidates.length === 0) {
    return []
  }

  const purgeRuntimeIds = await listOrphanRuntimeIds(tx, {
    serverId,
    runtimeIds: candidates.map((candidate) => candidate.runtimeId),
  })

  if (purgeRuntimeIds.length === 0) {
    return []
  }

  await enqueueRuntimePurgeJobs(tx, {
    reason:
      'devpush detected retained volumes for a Compose runtime that is no longer assigned.',
    runtimes: purgeRuntimeIds.map((runtimeId) => ({ serverId, runtimeId })),
  })

  await tx
    .update(agentRuntimeObservations)
    .set({
      purgeQueuedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentRuntimeObservations.serverId, serverId),
        inArray(agentRuntimeObservations.runtimeId, purgeRuntimeIds),
      ),
    )

  return purgeRuntimeIds
}

function normalizeRuntimeIds(runtimeIds: Array<string>) {
  const normalized = runtimeIds
    .map((runtimeId) => runtimeId.trim())
    .filter((runtimeId) => runtimeId.length > 0 && runtimeId.length <= 128)

  return Array.from(new Set(normalized)).slice(0, maxReportedRuntimeIds)
}

async function listOrphanRuntimeIds(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  {
    serverId,
    runtimeIds,
  }: {
    serverId: string
    runtimeIds: Array<string>
  },
) {
  const keepRuntimeIds = await listKeepRuntimeIds(tx, {
    serverId,
    runtimeIds,
  })

  return runtimeIds.filter(
    (runtimeId) =>
      runtimeId.startsWith(runtimeIdPrefix) && !keepRuntimeIds.has(runtimeId),
  )
}

async function recordRuntimeObservations(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  {
    serverId,
    runtimeIds,
    runtimes,
    now,
  }: {
    serverId: string
    runtimeIds: Array<string>
    runtimes: Array<ReportedRuntime>
    now: Date
  },
) {
  const servicesByRuntimeId = new Map(
    runtimes.map((runtime) => [runtime.runtimeId, runtime.services]),
  )
  const existingRows = await tx
    .select({
      runtimeId: agentRuntimeObservations.runtimeId,
    })
    .from(agentRuntimeObservations)
    .where(
      and(
        eq(agentRuntimeObservations.serverId, serverId),
        inArray(agentRuntimeObservations.runtimeId, runtimeIds),
      ),
    )
  const existingRuntimeIds = new Set(existingRows.map((row) => row.runtimeId))
  const newRuntimeIds = runtimeIds.filter(
    (runtimeId) => !existingRuntimeIds.has(runtimeId),
  )

  if (newRuntimeIds.length > 0) {
    await tx.insert(agentRuntimeObservations).values(
      newRuntimeIds.map((runtimeId) => ({
        id: crypto.randomUUID(),
        serverId,
        runtimeId,
        firstSeenAt: now,
        lastSeenAt: now,
        services: servicesByRuntimeId.get(runtimeId) ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    )
  }

  if (existingRuntimeIds.size > 0) {
    await tx
      .update(agentRuntimeObservations)
      .set({
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuntimeObservations.serverId, serverId),
          inArray(
            agentRuntimeObservations.runtimeId,
            Array.from(existingRuntimeIds),
          ),
        ),
      )
  }

  for (const [runtimeId, services] of servicesByRuntimeId) {
    if (!existingRuntimeIds.has(runtimeId)) {
      continue
    }

    await tx
      .update(agentRuntimeObservations)
      .set({ services, lastSeenAt: now, updatedAt: now })
      .where(
        and(
          eq(agentRuntimeObservations.serverId, serverId),
          eq(agentRuntimeObservations.runtimeId, runtimeId),
        ),
      )
  }
}

async function listKeepRuntimeIds(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  {
    serverId,
    runtimeIds,
  }: {
    serverId: string
    runtimeIds: Array<string>
  },
) {
  const activeEnvironmentRows = await tx
    .select({ runtimeId: environments.runtimeId })
    .from(environments)
    .where(
      and(
        eq(environments.serverId, serverId),
        inArray(environments.runtimeId, runtimeIds),
      ),
    )
  const inFlightDeploymentRows = await tx
    .select({ runtimeId: deployments.runtimeId })
    .from(deployments)
    .where(
      and(
        eq(deployments.serverId, serverId),
        inArray(deployments.runtimeId, runtimeIds),
        inArray(deployments.status, ['queued', 'running']),
      ),
    )
  const cleanupJobRows = await tx
    .select({ payload: agentJobs.payload })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.serverId, serverId),
        inArray(agentJobs.type, ['deprovision', 'purge']),
        inArray(agentJobs.status, ['queued', 'running']),
      ),
    )

  const keepRuntimeIds = new Set<string>()

  for (const row of activeEnvironmentRows) {
    keepRuntimeIds.add(row.runtimeId)
  }

  for (const row of inFlightDeploymentRows) {
    keepRuntimeIds.add(row.runtimeId)
  }

  for (const row of cleanupJobRows) {
    const cleanupRuntimeIds = parseCleanupRuntimeIds(row.payload)

    for (const runtimeId of cleanupRuntimeIds) {
      if (runtimeIds.includes(runtimeId)) {
        keepRuntimeIds.add(runtimeId)
      }
    }
  }

  return keepRuntimeIds
}

function parseCleanupRuntimeIds(payload: unknown) {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('runtimeIds' in payload) ||
    !Array.isArray(payload.runtimeIds)
  ) {
    return []
  }

  return payload.runtimeIds.filter(
    (runtimeId): runtimeId is string => typeof runtimeId === 'string',
  )
}
