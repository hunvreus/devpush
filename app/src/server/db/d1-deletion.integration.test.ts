import { pruneDeletedResources } from '@/server/deleted-resources'
import { required } from '@/test/required'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { replacePendingIdentity } from '@/server/auth/provider-identity'
import { createD1TestStores } from '@/test/d1'
import * as schema from './schema'
import { deleteProjectState } from '@/server/projects/deletion-state'
import { deleteTeamState } from '@/server/teams/deletion-state'
import {
  deleteUserState,
  cleanupDeletedUserState,
} from '@/server/users/deletion-state'
import type { UserCleanupJobPayload } from '@/server/users/deletion-state'
import {
  leaveMembership,
  mutateTeamMembership,
  mutateTeamOwnership,
} from '@/server/teams/membership'

let stores: Awaited<ReturnType<typeof createD1TestStores>>
let dispose = async () => {}
beforeAll(async () => {
  stores = await createD1TestStores()
  dispose = () => stores.runtime.dispose()
}, 30_000)
afterAll(async () => {
  await dispose()
})

async function seed(prefix: string) {
  const db = stores.main
  const ids = {
    userId: `${prefix}-owner`,
    teamId: `${prefix}-team`,
    projectId: `${prefix}-project`,
    serverId: `${prefix}-server`,
    environmentId: `${prefix}-environment`,
  }
  await db.batch([
    db.insert(schema.user).values({
      id: ids.userId,
      username: ids.userId,
      name: ids.userId,
      email: `${ids.userId}@example.com`,
      emailVerified: true,
    }),
    db
      .insert(schema.teams)
      .values({ id: ids.teamId, name: ids.teamId, slug: ids.teamId }),
    db.insert(schema.teamMembers).values({
      id: `${prefix}-membership`,
      userId: ids.userId,
      teamId: ids.teamId,
      role: 'owner',
    }),
    db.insert(schema.servers).values({
      id: ids.serverId,
      teamId: ids.teamId,
      name: ids.serverId,
      handle: ids.serverId,
      status: 'connected',
    }),
    db.insert(schema.projects).values({
      id: ids.projectId,
      teamId: ids.teamId,
      name: ids.projectId,
      slug: ids.projectId,
      githubRepo: 'example/project',
      defaultServerId: ids.serverId,
    }),
    db.insert(schema.environments).values({
      id: ids.environmentId,
      projectId: ids.projectId,
      name: 'Production',
      slug: 'production',
      branch: 'main',
      runtimeId: `dp_${prefix}`,
      isProduction: true,
    }),
    db.insert(schema.aliases).values({
      id: `${prefix}-alias`,
      projectId: ids.projectId,
      environmentId: ids.environmentId,
      hostname: `${prefix}.example.com`,
      type: 'environment',
    }),
    db.insert(schema.domains).values({
      id: `${prefix}-domain`,
      projectId: ids.projectId,
      environmentId: ids.environmentId,
      hostname: `${prefix}-custom.example.com`,
    }),
  ])
  return ids
}

async function addCredentials(userId: string) {
  const db = stores.main
  await db.batch([
    db.insert(schema.session).values({
      id: `${userId}-session`,
      userId,
      token: `${userId}-token`,
      expiresAt: new Date(Date.now() + 60_000),
    }),
    db.insert(schema.account).values({
      id: `${userId}-account`,
      userId,
      accountId: userId,
      providerId: 'github',
    }),
  ])
}

describe('atomic deletion on D1', () => {
  test('pending OAuth identity replacement stays atomic when insertion fails', async () => {
    const db = stores.main
    const input = {
      identifier: 'provider:test',
      value: 'encrypted-original',
      expiresAt: new Date(Date.now() + 60000),
    }
    await replacePendingIdentity(db, input)
    await db.run(sql`create trigger reject_identity before insert on verification
      when new.value = 'encrypted-failed' begin select raise(abort, 'simulated identity failure'); end`)
    try {
      await expect(
        replacePendingIdentity(db, { ...input, value: 'encrypted-failed' }),
      ).rejects.toThrow('simulated identity failure')
      expect(
        required(
          (
            await db
              .select()
              .from(schema.verification)
              .where(eq(schema.verification.identifier, input.identifier))
          )[0],
        ).value,
      ).toBe('encrypted-original')
    } finally {
      await db.run(sql`drop trigger reject_identity`)
    }
    await Promise.all(
      ['encrypted-one', 'encrypted-two'].map((value) =>
        replacePendingIdentity(db, { ...input, value }),
      ),
    )
    const rows = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, input.identifier))
    expect(rows).toHaveLength(1)
    expect(['encrypted-one', 'encrypted-two']).toContain(
      required(rows[0]).value,
    )
  })

  test('project deletion keeps every runtime in bounded cleanup jobs and rolls back a failed final status', async () => {
    const db = stores.main
    const ids = await seed('delete-project')
    const fixtureWrites = []
    for (let offset = 0; offset < 251; offset += 6) {
      fixtureWrites.push(
        db.insert(schema.deployments).values(
          Array.from({ length: Math.min(6, 251 - offset) }, (_, index) => ({
            id: `project-runtime-${offset + index}`,
            environmentId: ids.environmentId,
            serverId: ids.serverId,
            status: 'queued' as const,
            repoId: 1,
            repoFullName: 'example/project',
            gitSha: 'sha',
            gitBranch: 'main',
            config: {},
            envVars: '[]',
            runtimeId:
              offset + index === 0
                ? 'dp_delete-project'
                : `dp_runtime_${offset + index}`,
          })),
        ),
      )
    }
    // Keep bounded inserts in one D1 request; the assertions exercise deletion, not fixture round trips.
    await db.batch([required(fixtureWrites[0]), ...fixtureWrites.slice(1)])
    const input = { ...ids, removeDeployments: true, now: new Date() }
    await db
      .update(schema.teamMembers)
      .set({ role: 'member' })
      .where(eq(schema.teamMembers.userId, ids.userId))
    expect(await deleteProjectState(db, input)).toBe(false)
    expect(
      await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.projectId, ids.projectId)),
    ).toEqual([])
    await db
      .update(schema.teamMembers)
      .set({ role: 'owner' })
      .where(eq(schema.teamMembers.userId, ids.userId))
    await db.run(sql`create trigger reject_project_deletion before update of status on projects
      when new.id = 'delete-project-project' and new.status = 'deleted' begin select raise(abort, 'simulated project deletion failure'); end`)
    try {
      await expect(deleteProjectState(db, input)).rejects.toThrow(
        'simulated project deletion failure',
      )
      expect(
        await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.projectId, ids.projectId)),
      ).toEqual([])
      expect(
        await db
          .select()
          .from(schema.deployments)
          .where(
            and(
              eq(schema.deployments.environmentId, ids.environmentId),
              eq(schema.deployments.status, 'queued'),
            ),
          ),
      ).toHaveLength(251)
      expect(
        await db
          .select()
          .from(schema.aliases)
          .where(eq(schema.aliases.projectId, ids.projectId)),
      ).toHaveLength(1)
      expect(
        await db
          .select()
          .from(schema.domains)
          .where(eq(schema.domains.projectId, ids.projectId)),
      ).toHaveLength(1)
    } finally {
      await db.run(sql`drop trigger reject_project_deletion`)
    }
    const outcomes = await Promise.all([
      deleteProjectState(db, input),
      deleteProjectState(db, input),
    ])
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const jobs = await db
      .select()
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.projectId, ids.projectId))
    expect(jobs).toHaveLength(4)
    for (const type of ['deprovision', 'purge']) {
      const matching = jobs.filter((j) => j.type === type)
      const payloads = matching.map(
        (j) => j.payload as { runtimeIds: string[]; removeVolumes: boolean },
      )
      expect(
        payloads.map((p) => p.runtimeIds.length).sort((a, b) => a - b),
      ).toEqual([51, 200])
      expect(new Set(payloads.flatMap((p) => p.runtimeIds)).size).toBe(251)
      expect(
        payloads.every((p) => p.removeVolumes === (type === 'purge')),
      ).toBe(true)
      expect(
        matching.every(
          (j) =>
            j.availableAt.getTime() ===
            input.now.getTime() + (type === 'purge' ? 7 * 86400000 : 0),
        ),
      ).toBe(true)
    }
    expect(
      required(
        (
          await db
            .select()
            .from(schema.environments)
            .where(eq(schema.environments.id, ids.environmentId))
        )[0],
      ).status,
    ).toBe('deleted')
    expect(
      await db
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.projectId, ids.projectId)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.projectId, ids.projectId)),
    ).toHaveLength(1)
    await pruneDeletedResources({ store: db, now: input.now })
    expect(
      await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.projectId, ids.projectId)),
    ).toHaveLength(1)
    await db
      .update(schema.agentJobs)
      .set({ status: 'succeeded' })
      .where(sql`project_id = ${ids.projectId} and type = 'deprovision'`)
    await pruneDeletedResources({ store: db, now: input.now })
    expect(
      await db
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.projectId, ids.projectId)),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.projectId, ids.projectId)),
    ).toEqual([])
    const kept = await seed('keep-project')
    expect(
      await deleteProjectState(db, {
        ...kept,
        removeDeployments: false,
        now: new Date(),
      }),
    ).toBe(true)
    expect(
      required(
        (
          await db
            .select()
            .from(schema.environments)
            .where(eq(schema.environments.id, kept.environmentId))
        )[0],
      ).status,
    ).toBe('active')
    expect(
      await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.projectId, kept.projectId)),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(schema.aliases)
        .where(eq(schema.aliases.projectId, kept.projectId)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.projectId, kept.projectId)),
    ).toHaveLength(1)
  })

  test('team deletion respects current default teams and restores its subtree after a late failure', async () => {
    const db = stores.main
    const ids = await seed('delete-team')
    const input = { userId: ids.userId, teamId: ids.teamId, now: new Date() }
    await db
      .update(schema.user)
      .set({ defaultTeamId: ids.teamId })
      .where(eq(schema.user.id, ids.userId))
    expect(await deleteTeamState(db, input)).toBe(false)
    expect(
      await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.teamId, ids.teamId)),
    ).toEqual([])
    await db
      .update(schema.user)
      .set({ defaultTeamId: null })
      .where(eq(schema.user.id, ids.userId))
    await db.insert(schema.agentJobs).values({
      id: 'team-old-backup-job',
      serverId: ids.serverId,
      type: 'backup',
      status: 'running',
      payload: {},
    })
    await db.run(sql`create trigger reject_team_deletion before update of status on teams
      when new.id = 'delete-team-team' and new.status = 'deleted' begin select raise(abort, 'simulated team deletion failure'); end`)
    try {
      await expect(deleteTeamState(db, input)).rejects.toThrow(
        'simulated team deletion failure',
      )
      expect(
        required(
          (
            await db
              .select()
              .from(schema.projects)
              .where(eq(schema.projects.id, ids.projectId))
          )[0],
        ).status,
      ).toBe('active')
      expect(
        required(
          (
            await db
              .select()
              .from(schema.servers)
              .where(eq(schema.servers.id, ids.serverId))
          )[0],
        ).status,
      ).toBe('connected')
      expect(
        required(
          (
            await db
              .select()
              .from(schema.agentJobs)
              .where(eq(schema.agentJobs.id, 'team-old-backup-job'))
          )[0],
        ).status,
      ).toBe('running')
      expect(
        await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.teamId, ids.teamId)),
      ).toEqual([])
    } finally {
      await db.run(sql`drop trigger reject_team_deletion`)
    }
    expect(await deleteTeamState(db, input)).toBe(true)
    expect(
      await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.teamId, ids.teamId)),
    ).toHaveLength(2)
    expect(
      required(
        (
          await db
            .select()
            .from(schema.agentJobs)
            .where(eq(schema.agentJobs.id, 'team-old-backup-job'))
        )[0],
      ).status,
    ).toBe('canceled')
    expect(
      required(
        (
          await db
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.id, ids.projectId))
        )[0],
      ).status,
    ).toBe('deleted')
    expect(
      required(
        (
          await db
            .select()
            .from(schema.servers)
            .where(eq(schema.servers.id, ids.serverId))
        )[0],
      ).status,
    ).toBe('deleted')
    expect(await deleteTeamState(db, input)).toBe(false)
  })

  test('account deletion commits credentials and cleanup together and leaves one active owner under a race', async () => {
    const db = stores.main
    const ids = await seed('delete-user')
    const otherId = 'delete-user-other'
    await db.insert(schema.user).values({
      id: otherId,
      username: otherId,
      name: otherId,
      email: `${otherId}@example.com`,
    })
    await db.insert(schema.teamMembers).values({
      id: 'delete-user-other-membership',
      userId: otherId,
      teamId: ids.teamId,
      role: 'owner',
    })
    await addCredentials(ids.userId)
    await addCredentials(otherId)
    await db.run(sql`create trigger reject_account_deletion before update of status on user
      when new.id = 'delete-user-owner' and new.status = 'deleted' begin select raise(abort, 'simulated account deletion failure'); end`)
    try {
      await expect(
        deleteUserState(db, {
          userId: ids.userId,
          email: `${ids.userId}@example.com`,
          now: new Date(),
        }),
      ).rejects.toThrow('simulated account deletion failure')
      expect(
        await db
          .select()
          .from(schema.session)
          .where(eq(schema.session.userId, ids.userId)),
      ).toHaveLength(1)
      expect(
        await db
          .select()
          .from(schema.account)
          .where(eq(schema.account.userId, ids.userId)),
      ).toHaveLength(1)
      expect(
        await db
          .select()
          .from(schema.userCleanupJobs)
          .where(eq(schema.userCleanupJobs.userId, ids.userId)),
      ).toEqual([])
    } finally {
      await db.run(sql`drop trigger reject_account_deletion`)
    }
    const outcomes = await Promise.all(
      [ids.userId, otherId].map((userId) =>
        deleteUserState(db, {
          userId,
          email: `${userId}@example.com`,
          now: new Date(),
        }),
      ),
    )
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const members = await db
      .select()
      .from(schema.user)
      .where(sql`id in (${ids.userId}, ${otherId})`)
    const survivor = members.find((u) => u.status === 'active')!
    const deleted = members.find((u) => u.status === 'deleted')!
    expect(
      await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, deleted.id)),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, deleted.id)),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, survivor.id)),
    ).toHaveLength(1)
    const [job] = await db
      .select()
      .from(schema.userCleanupJobs)
      .where(eq(schema.userCleanupJobs.userId, deleted.id))
    expect(required(job).payload).toMatchObject({
      schemaVersion: 1,
      userId: deleted.id,
      email: deleted.email,
      soleMemberOwnedTeamIds: [],
    })
    expect(
      await leaveMembership(db, { teamId: ids.teamId, userId: survivor.id }),
    ).toBe(false)
    expect(
      await mutateTeamMembership(db, {
        teamId: ids.teamId,
        actorId: survivor.id,
        memberId: survivor.id,
        action: 'role',
        role: 'admin',
      }),
    ).toBe(false)
    await db
      .update(schema.teamMembers)
      .set({ role: 'member' })
      .where(eq(schema.teamMembers.userId, deleted.id))
    expect(
      await mutateTeamOwnership(db, {
        teamId: ids.teamId,
        actorId: survivor.id,
        memberId: deleted.id,
      }),
    ).toBe(false)
  })

  test('queued user cleanup rolls back every effect, clears defaults and remains idempotent', async () => {
    const db = stores.main
    const ids = await seed('user-cleanup')
    const unrelatedId = 'user-cleanup-unrelated'
    await db.insert(schema.user).values({
      id: unrelatedId,
      username: unrelatedId,
      name: unrelatedId,
      email: `${unrelatedId}@example.com`,
      defaultTeamId: ids.teamId,
    })
    await db.insert(schema.teamInvites).values({
      id: 'user-cleanup-invite',
      teamId: ids.teamId,
      email: 'invited@example.com',
      inviterId: ids.userId,
      tokenHash: 'user-cleanup-token',
      expiresAt: new Date(Date.now() + 60000),
    })
    await expect(
      cleanupDeletedUserState(db, {
        payload: {
          schemaVersion: 1,
          userId: ids.userId,
          email: `${ids.userId}@example.com`,
          avatarPath: null,
          soleMemberOwnedTeamIds: [ids.teamId],
        },
        now: new Date(),
        claim: { id: 'missing-claim', attempt: 1 },
      }),
    ).rejects.toThrow('Deleted user not found.')
    expect(
      required(
        (
          await db
            .select()
            .from(schema.teams)
            .where(eq(schema.teams.id, ids.teamId))
        )[0],
      ).status,
    ).toBe('active')
    expect(
      await deleteUserState(db, {
        userId: ids.userId,
        email: `${ids.userId}@example.com`,
        now: new Date(),
      }),
    ).toBe(true)
    const [job] = await db
      .select()
      .from(schema.userCleanupJobs)
      .where(eq(schema.userCleanupJobs.userId, ids.userId))
    const payload = required(job).payload as UserCleanupJobPayload
    const now = new Date()
    const claim = { id: required(job).id, attempt: 1 }
    await db
      .update(schema.userCleanupJobs)
      .set({ status: 'running', attempt: claim.attempt, claimedAt: now })
      .where(eq(schema.userCleanupJobs.id, claim.id))
    expect(payload.soleMemberOwnedTeamIds).toEqual([ids.teamId])
    await db.run(sql`create trigger reject_user_cleanup before delete on team_members
      when old.user_id = 'user-cleanup-owner' begin select raise(abort, 'simulated user cleanup failure'); end`)
    try {
      await expect(
        cleanupDeletedUserState(db, { payload, now, claim }),
      ).rejects.toThrow('simulated user cleanup failure')
      expect(
        required(
          (
            await db
              .select()
              .from(schema.teams)
              .where(eq(schema.teams.id, ids.teamId))
          )[0],
        ).status,
      ).toBe('active')
      expect(
        required(
          (
            await db
              .select()
              .from(schema.projects)
              .where(eq(schema.projects.id, ids.projectId))
          )[0],
        ).status,
      ).toBe('active')
      expect(
        await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.teamId, ids.teamId)),
      ).toEqual([])
      expect(
        await db
          .select()
          .from(schema.teamInvites)
          .where(eq(schema.teamInvites.id, 'user-cleanup-invite')),
      ).toHaveLength(0)
      expect(
        required(
          (
            await db
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, unrelatedId))
          )[0],
        ).defaultTeamId,
      ).toBe(ids.teamId)
    } finally {
      await db.run(sql`drop trigger reject_user_cleanup`)
    }
    await cleanupDeletedUserState(db, { payload, now, claim })
    expect(
      required(
        (
          await db
            .select()
            .from(schema.teams)
            .where(eq(schema.teams.id, ids.teamId))
        )[0],
      ).status,
    ).toBe('deleted')
    expect(
      required(
        (
          await db
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, unrelatedId))
        )[0],
      ).defaultTeamId,
    ).toBeNull()
    expect(
      await db
        .select()
        .from(schema.teamInvites)
        .where(eq(schema.teamInvites.id, 'user-cleanup-invite')),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.userId, ids.userId)),
    ).toEqual([])
    expect(
      await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.teamId, ids.teamId)),
    ).toHaveLength(2)
    await cleanupDeletedUserState(db, { payload, now, claim })
    expect(
      await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.teamId, ids.teamId)),
    ).toHaveLength(2)
  })
})
