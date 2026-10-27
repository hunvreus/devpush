import { db } from '#devpush/server/db'
import { reconcileRuntimeState } from './runtime-state'

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
  runtimeIds: string[]
  runtimes?: ReportedRuntime[]
  now?: Date
}) {
  const normalized = Array.from(
    new Set(
      runtimeIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 128),
    ),
  ).slice(0, 200)
  return reconcileRuntimeState(db, {
    serverId,
    runtimeIds: normalized,
    runtimes,
    now,
  })
}
