import { eq, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { closeDb, db, logsDb } from './index'
import { deploymentLogs, runtimeLogs } from './log-schema'
import { teams } from './schema'
import { pruneExpiredRuntimeLogs } from '@/server/logs/retention'

afterAll(closeDb)

describe('separate log storage', () => {
  test('keeps runtime output out of the main database and prunes abandoned runtimes in bounded batches', async () => {
    expect(
      await db.all(
        sql`select name from sqlite_master where type = 'table' and name in ('runtime_logs', 'deployment_logs')`,
      ),
    ).toEqual([])
    const now = new Date('1900-01-10T00:00:00Z')
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const row = {
      projectId: 'deleted-project',
      environmentId: 'deleted-environment',
      serverId: 'deleted-server',
      runtimeId: 'stopped-runtime',
      service: 'web',
      content: 'captured',
      searchContent: 'captured',
    }
    for (let offset = 0; offset < 1005; offset += 8) {
      await logsDb.insert(runtimeLogs).values(
        Array.from({ length: Math.min(8, 1005 - offset) }, (_, index) => ({
          ...row,
          id: `old-${offset + index}`,
          contentHash: `hash-${offset + index}`,
          observedAt: new Date(cutoff.getTime() - 1),
        })),
      )
    }
    await logsDb.insert(runtimeLogs).values({
      ...row,
      id: 'at-cutoff',
      contentHash: 'at-cutoff',
      observedAt: cutoff,
    })
    expect(await pruneExpiredRuntimeLogs(now)).toEqual({ deleted: 1005 })
    expect(
      await logsDb.select({ id: runtimeLogs.id }).from(runtimeLogs),
    ).toEqual([{ id: 'at-cutoff' }])
    await logsDb.delete(runtimeLogs).where(eq(runtimeLogs.id, 'at-cutoff'))
  })

  test('stores indexed project identity and deduplicates replayed sequences', async () => {
    const row = {
      projectId: 'project-a',
      environmentId: 'environment-a',
      deploymentId: 'deployment-a',
      serverId: 'server-a',
      branch: 'main',
      stream: 'deploy',
      seq: 1,
      content: 'ÄPI ready',
      searchContent: 'ÄPI ready'.toLowerCase(),
    }
    await logsDb.insert(deploymentLogs).values(row)
    expect(
      await logsDb
        .insert(deploymentLogs)
        .values(row)
        .onConflictDoNothing()
        .returning(),
    ).toEqual([])
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.projectId, 'project-b')),
    ).toEqual([])
    expect(
      await logsDb
        .select()
        .from(deploymentLogs)
        .where(like(deploymentLogs.searchContent, '%äpi%')),
    ).toHaveLength(1)
    await logsDb
      .delete(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, row.deploymentId))
  })
  test('a log write transaction does not acquire the main database write lock', async () => {
    let started = () => {}
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let resume = () => {}
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const transaction = logsDb.transaction(async (tx) => {
      await tx.insert(deploymentLogs).values({
        projectId: 'project',
        environmentId: 'environment',
        deploymentId: 'deployment',
        serverId: 'server',
        branch: 'main',
        stream: 'deploy',
        seq: 1,
        content: 'ready',
        searchContent: 'ready',
      })
      started()
      await gate
    })
    await ready
    try {
      await db.insert(teams).values({
        id: 'independent-team',
        slug: 'independent-team',
        name: 'Independent team',
      })
      expect(
        await db.select().from(teams).where(eq(teams.id, 'independent-team')),
      ).toHaveLength(1)
    } finally {
      resume()
      await transaction
      await db.delete(teams).where(eq(teams.id, 'independent-team'))
      await logsDb
        .delete(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, 'deployment'))
    }
  })
})
