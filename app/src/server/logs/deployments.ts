import { config } from '#devpush/server/config'
import { and, eq, sql } from 'drizzle-orm'

import { logsDb } from '#devpush/server/db'
import { deploymentLogs } from '#devpush/server/db/log-schema'

type Identity = {
  projectId: string
  environmentId: string
  deploymentId: string
  serverId: string
  branch: string
}

// Identity must come from the authorized main deployment lookup, never the
// agent payload.
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
  const maxLines = config.DEVPUSH_DEPLOYMENT_LOG_MAX_LINES
  const lineBytes = config.DEVPUSH_DEPLOYMENT_LOG_LINE_BYTES
  const bounded = lines
    .slice(0, Math.max(0, maxLines - startSeq + 1))
    .map((content) => {
      const bytes = new TextEncoder().encode(content)
      if (bytes.length <= lineBytes) return content
      const suffix = '… [line truncated]'
      const max = lineBytes - new TextEncoder().encode(suffix).length
      let end = max
      while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
      return new TextDecoder().decode(bytes.subarray(0, end)) + suffix
    })
  const rows = bounded.map((content, index) => ({
    seq: startSeq + index,
    content,
  }))
  if (lines.length && startSeq + lines.length - 1 > maxLines)
    rows.push({
      seq: maxLines + 1,
      content:
        '[devpush] Deployment log limit reached. Further output was omitted; deployment execution is unaffected.',
    })
  const createdAt = new Date()
  for (let offset = 0; offset < rows.length; offset += 32) {
    const statements = []
    for (
      let start = offset;
      start < Math.min(offset + 32, rows.length);
      start += 8
    ) {
      statements.push(
        logsDb
          .insert(deploymentLogs)
          .values(
            rows.slice(start, start + 8).map(({ content, seq }) => ({
              ...identity,
              stream: 'deploy',
              seq,
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
