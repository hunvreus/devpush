import { and, eq, sql } from 'drizzle-orm'

import { logsDb } from '@/server/db'
import { deploymentLogs } from '@/server/db/log-schema'

type Identity = {
  projectId: string
  environmentId: string
  deploymentId: string
  serverId: string
  branch: string
}

// Identity must come from the authorized main deployment lookup, never the
// agent payload. Small control events stay atomic with state in the main store.
export async function appendDeploymentLogs(
  identity: Identity,
  startSeq: number,
  lines: string[],
) {
  if (
    !Number.isSafeInteger(startSeq) ||
    startSeq < 1 ||
    !Number.isSafeInteger(startSeq + lines.length - 1)
  )
    throw new Error('A positive deployment log sequence is required.')
  const createdAt = new Date()
  for (let offset = 0; offset < lines.length; offset += 32) {
    const statements = []
    for (
      let start = offset;
      start < Math.min(offset + 32, lines.length);
      start += 8
    ) {
      statements.push(
        logsDb
          .insert(deploymentLogs)
          .values(
            lines.slice(start, start + 8).map((content, index) => ({
              ...identity,
              stream: 'deploy',
              seq: startSeq + start + index,
              content,
              searchContent: content.toLowerCase(),
              createdAt,
            })),
          )
          .onConflictDoNothing({
            target: [
              deploymentLogs.deploymentId,
              deploymentLogs.stream,
              deploymentLogs.seq,
            ],
          })
          .returning({ seq: deploymentLogs.seq }),
      )
    }
    const [first, ...rest] = statements
    if (first) await logsDb.batch([first, ...rest])
  }
}

export async function nextDeploymentLogSeq(deploymentId: string) {
  const [row] = await logsDb
    .select({ value: sql<number>`coalesce(max(${deploymentLogs.seq}), 0) + 1` })
    .from(deploymentLogs)
    .where(
      and(
        eq(deploymentLogs.deploymentId, deploymentId),
        eq(deploymentLogs.stream, 'deploy'),
      ),
    )
  return Number(row?.value ?? 1)
}
