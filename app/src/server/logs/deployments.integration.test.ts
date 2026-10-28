import { afterAll, afterEach, expect, test } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, logsDb } from '#devpush/server/db'
import { config } from '#devpush/server/config'
import { deploymentLogs } from '#devpush/server/db/log-schema'
import { appendDeploymentLogs, nextDeploymentLogSeq } from './deployments'

const original = {
  DEVPUSH_DEPLOYMENT_LOG_MAX_LINES: config.DEVPUSH_DEPLOYMENT_LOG_MAX_LINES,
  DEVPUSH_DEPLOYMENT_LOG_LINE_BYTES: config.DEVPUSH_DEPLOYMENT_LOG_LINE_BYTES,
}
const ids: string[] = []
afterAll(closeDb)
afterEach(async () => {
  Object.assign(config, original)
  for (const id of ids.splice(0))
    await logsDb
      .delete(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, id))
})
test('deployment logs bound rows and UTF-8 bytes, keep one visible limit notice, and acknowledge replays', async () => {
  config.DEVPUSH_DEPLOYMENT_LOG_MAX_LINES = 2
  config.DEVPUSH_DEPLOYMENT_LOG_LINE_BYTES = 64
  const deploymentId = crypto.randomUUID()
  ids.push(deploymentId)
  const identity = {
    deploymentId,
    projectId: 'project',
    environmentId: 'env',
    serverId: 'server',
    branch: 'main',
  }
  await appendDeploymentLogs(identity, 1, [
    '🔥'.repeat(40),
    'known line',
    'omitted',
  ])
  await appendDeploymentLogs(identity, 1, [
    '🔥'.repeat(40),
    'known line',
    'omitted',
  ])
  await appendDeploymentLogs(identity, 1000, ['also omitted'])
  const rows = await logsDb
    .select()
    .from(deploymentLogs)
    .where(eq(deploymentLogs.deploymentId, deploymentId))
    .orderBy(deploymentLogs.seq)
  expect(rows).toHaveLength(3)
  expect(new TextEncoder().encode(rows[0]!.content).length).toBeLessThanOrEqual(
    64,
  )
  expect(rows[0]!.content).not.toContain('�')
  expect(rows[1]!.content).toBe('known line')
  expect(rows[2]!.content).toContain('[devpush] Deployment log limit reached')
  expect(await nextDeploymentLogSeq(deploymentId)).toBe(4)
})
