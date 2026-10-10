import { required } from '@/test/required'
import { eq, inArray } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { auth, authMethods } from '@/lib/auth'
import { config } from '@/server/config'
import { closeDb, db } from '@/server/db'
import {
  account,
  agentJobs,
  aliases,
  deployments,
  environments,
  projects,
  servers,
  session,
  teamInvites,
  teamMembers,
  teams,
  user,
  userCleanupJobs,
} from '@/server/db/schema'
import {
  backfillAuthAccountIdentities,
  deleteUserAccount,
  disconnectAuthAccount,
  leaveTeam,
  runQueuedUserCleanupJobs,
  updateUserGeneral,
} from './service'

const touchedAccountIds: Array<string> = []
const touchedCleanupJobIds: Array<string> = []
const touchedJobIds: Array<string> = []
const touchedHostnameIds: Array<string> = []
const touchedDeploymentIds: Array<string> = []
const touchedEnvironmentIds: Array<string> = []
const touchedProjectIds: Array<string> = []
const touchedServerIds: Array<string> = []
const touchedSessionIds: Array<string> = []
const touchedInviteIds: Array<string> = []
const touchedUserIds: Array<string> = []
const touchedTeamIds: Array<string> = []

afterEach(async () => {
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('deleteUserAccount integration', () => {
  test('ignores already-deleted teams when deleting sole-owned active teams', async () => {
    const { activeTeamId, deletedTeamId, userId } = await createUserWithTeams({
      activeTeamCount: 1,
      deletedTeamCount: 1,
    })

    await deleteUserAccount({
      userId,
      confirmationName: `${userId}@example.com`,
    })

    const queuedCleanupJobs = await db
      .select({ id: userCleanupJobs.id, status: userCleanupJobs.status })
      .from(userCleanupJobs)
      .where(eq(userCleanupJobs.userId, userId))
    touchedCleanupJobIds.push(...queuedCleanupJobs.map((job) => job.id))

    const userRows = await db
      .select({
        id: user.id,
        status: user.status,
        defaultTeamId: user.defaultTeamId,
      })
      .from(user)
      .where(eq(user.id, userId))
    const teamRows = await db
      .select({ id: teams.id, status: teams.status })
      .from(teams)
      .where(inArray(teams.id, [activeTeamId, deletedTeamId]))

    expect(userRows).toEqual([
      { id: userId, status: 'deleted', defaultTeamId: null },
    ])
    expect(queuedCleanupJobs).toHaveLength(1)
    expect(queuedCleanupJobs.at(0)?.status).toBe('queued')
    expect(new Map(teamRows.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [activeTeamId, 'active'],
        [deletedTeamId, 'deleted'],
      ]),
    )

    await runQueuedUserCleanupJobs()

    const cleanedTeamRows = await db
      .select({ id: teams.id, status: teams.status })
      .from(teams)
      .where(inArray(teams.id, [activeTeamId, deletedTeamId]))

    expect(new Map(teamRows.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [activeTeamId, 'active'],
        [deletedTeamId, 'deleted'],
      ]),
    )
    expect(new Map(cleanedTeamRows.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [activeTeamId, 'deleted'],
        [deletedTeamId, 'deleted'],
      ]),
    )
  })

  test('keeps teams that still have another owner', async () => {
    const userId = makeId('user')
    const otherUserId = makeId('user')
    const teamId = makeId('team')
    touchedUserIds.push(userId, otherUserId)
    touchedTeamIds.push(teamId)

    await db
      .insert(user)
      .values([
        makeUser(userId, `${userId}@example.com`),
        makeUser(otherUserId, `${otherUserId}@example.com`),
      ])
    await db.insert(teams).values({
      id: teamId,
      name: 'Shared team',
      slug: makeSlug(teamId),
    })
    await db.insert(teamMembers).values([
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId,
      },
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId: otherUserId,
      },
    ])

    await deleteUserAccount({
      userId,
      confirmationName: `${userId}@example.com`,
    })
    await runQueuedUserCleanupJobs()

    const teamRows = await db
      .select({ status: teams.status })
      .from(teams)
      .where(eq(teams.id, teamId))
    const otherMemberRows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))
    const userRows = await db
      .select({
        id: user.id,
        status: user.status,
        defaultTeamId: user.defaultTeamId,
      })
      .from(user)
      .where(eq(user.id, userId))

    expect(teamRows).toEqual([{ status: 'active' }])
    expect(otherMemberRows).toEqual([{ userId: otherUserId }])
    expect(userRows).toEqual([
      { id: userId, status: 'deleted', defaultTeamId: null },
    ])
  })

  test('blocks account deletion when the user is sole owner of a team with other members', async () => {
    const userId = makeId('user')
    const memberUserId = makeId('user')
    const teamId = makeId('team')
    touchedUserIds.push(userId, memberUserId)
    touchedTeamIds.push(teamId)

    await db
      .insert(user)
      .values([
        makeUser(userId, `${userId}@example.com`),
        makeUser(memberUserId, `${memberUserId}@example.com`),
      ])
    await db.insert(teams).values({
      id: teamId,
      name: 'Needs transfer',
      slug: makeSlug(teamId),
    })
    await db.insert(teamMembers).values([
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId,
      },
      {
        id: makeId('member'),
        role: 'member',
        teamId,
        userId: memberUserId,
      },
    ])

    await expect(
      deleteUserAccount({
        userId,
        confirmationName: `${userId}@example.com`,
      }),
    ).rejects.toThrow(
      'Transfer ownership of "Needs transfer" before deleting your account.',
    )

    const [userRows, teamRows, memberRows] = await Promise.all([
      db
        .select({ id: user.id, status: user.status })
        .from(user)
        .where(eq(user.id, userId)),
      db
        .select({ status: teams.status })
        .from(teams)
        .where(eq(teams.id, teamId)),
      db
        .select({ userId: teamMembers.userId, role: teamMembers.role })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId)),
    ])

    expect(userRows).toEqual([{ id: userId, status: 'active' }])
    expect(teamRows).toEqual([{ status: 'active' }])
    expect(new Map(memberRows.map((row) => [row.userId, row.role]))).toEqual(
      new Map([
        [userId, 'owner'],
        [memberUserId, 'member'],
      ]),
    )
  })

  test('blocks account deletion when the user owns a team with non-owner members', async () => {
    const userId = makeId('user')
    const memberUserId = makeId('user')
    const teamId = makeId('team')
    touchedUserIds.push(userId, memberUserId)
    touchedTeamIds.push(teamId)

    await db
      .insert(user)
      .values([
        makeUser(userId, `${userId}@example.com`),
        makeUser(memberUserId, `${memberUserId}@example.com`),
      ])
    await db.insert(teams).values({
      id: teamId,
      name: 'Owned with members',
      slug: makeSlug(teamId),
    })
    await db.insert(teamMembers).values([
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId,
      },
      {
        id: makeId('member'),
        role: 'member',
        teamId,
        userId: memberUserId,
      },
    ])

    await expect(
      deleteUserAccount({
        userId,
        confirmationName: `${userId}@example.com`,
      }),
    ).rejects.toThrow(
      'Transfer ownership of "Owned with members" before deleting your account.',
    )

    const [userRows, teamRows, memberRows] = await Promise.all([
      db.select({ status: user.status }).from(user).where(eq(user.id, userId)),
      db
        .select({ status: teams.status })
        .from(teams)
        .where(eq(teams.id, teamId)),
      db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId)),
    ])

    expect(userRows).toEqual([{ status: 'active' }])
    expect(teamRows).toEqual([{ status: 'active' }])
    expect(memberRows).toHaveLength(2)
  })

  test('deletes sole-member team resources atomically with the user', async () => {
    const userId = makeId('user')
    const teamId = makeId('team')
    const serverId = makeId('server')
    const projectId = makeId('project')
    const environmentId = makeId('environment')
    const deploymentId = makeId('deployment')
    const hostnameId = makeId('hostname')
    const inviteId = makeId('invite')
    const accountId = makeId('account')
    const sessionId = makeId('session')
    touchedUserIds.push(userId)
    touchedAccountIds.push(accountId)
    touchedSessionIds.push(sessionId)
    touchedTeamIds.push(teamId)
    touchedServerIds.push(serverId)
    touchedProjectIds.push(projectId)
    touchedEnvironmentIds.push(environmentId)
    touchedDeploymentIds.push(deploymentId)
    touchedHostnameIds.push(hostnameId)
    touchedInviteIds.push(inviteId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(account).values({
      id: accountId,
      accountId: 'github-account',
      providerId: 'github',
      userId,
    })
    await db.insert(session).values({
      id: sessionId,
      expiresAt: new Date(Date.now() + 86_400_000),
      token: makeId('session-token'),
      userId,
    })
    await db.insert(teams).values({
      id: teamId,
      name: 'Owned team',
      slug: makeSlug(teamId),
    })
    await db.insert(teamMembers).values({
      id: makeId('member'),
      role: 'owner',
      teamId,
      userId,
    })
    await db.insert(servers).values({
      id: serverId,
      name: 'Owned server',
      handle: 'owned-server',
      status: 'connected',
      teamId,
    })
    await db.insert(projects).values({
      id: projectId,
      githubRepo: 'example/owned',
      name: 'Owned project',
      slug: makeSlug(projectId),
      teamId,
    })
    await db.insert(environments).values({
      id: environmentId,
      branch: 'main',
      isProduction: true,
      name: 'Production',
      projectId,
      runtimeId: 'owned-runtime',
      serverId,
      slug: 'production',
    })
    await db.insert(deployments).values({
      id: deploymentId,
      commitMeta: {},
      config: {
        schemaVersion: 1,
        runtime: {
          type: 'compose',
          path: 'compose.yml',
          releaseCommand: null,
          releaseService: 'web',
          readinessPath: null,
          deployCommand: null,
          rollbackCommand: null,
          timeoutSeconds: 1800,
        },
        routes: [],
      },
      environmentId,
      envVars: '[]',
      gitBranch: 'main',
      gitSha: 'abc123',
      phase: 'deploying',
      repoId: 1,
      repoFullName: 'example/owned',
      runtimeId: 'owned-runtime',
      serverId,
      status: 'running',
    })
    await db.insert(aliases).values({
      id: hostnameId,
      hostname: `${makeSlug(projectId)}.example.test`,
      projectId,
      environmentId,
      type: 'environment',
    })
    await db.insert(teamInvites).values({
      id: inviteId,
      email: `${makeId('invite')}@example.com`,
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: userId,
      role: 'member',
      teamId,
      tokenHash: makeId('token'),
    })

    await deleteUserAccount({
      userId,
      confirmationName: `${userId}@example.com`,
    })
    await runQueuedUserCleanupJobs()

    const [
      userRows,
      teamRows,
      projectRows,
      serverRows,
      deploymentRows,
      hostnameRows,
      inviteRows,
      accountRows,
      sessionRows,
      jobRows,
    ] = await Promise.all([
      db
        .select({
          id: user.id,
          status: user.status,
          defaultTeamId: user.defaultTeamId,
        })
        .from(user)
        .where(eq(user.id, userId)),
      db
        .select({ status: teams.status })
        .from(teams)
        .where(eq(teams.id, teamId)),
      db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId)),
      db
        .select({ status: servers.status })
        .from(servers)
        .where(eq(servers.id, serverId)),
      db
        .select({
          status: deployments.status,
          phase: deployments.phase,
          errorMessage: deployments.errorMessage,
        })
        .from(deployments)
        .where(eq(deployments.id, deploymentId)),
      db
        .select({ id: aliases.id })
        .from(aliases)
        .where(eq(aliases.id, hostnameId)),
      db
        .select({ id: teamInvites.id })
        .from(teamInvites)
        .where(eq(teamInvites.id, inviteId)),
      db
        .select({ id: account.id })
        .from(account)
        .where(eq(account.id, accountId)),
      db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, sessionId)),
      db
        .select({
          id: agentJobs.id,
          status: agentJobs.status,
          type: agentJobs.type,
          payload: agentJobs.payload,
          availableAt: agentJobs.availableAt,
        })
        .from(agentJobs)
        .where(eq(agentJobs.teamId, teamId)),
    ])
    touchedJobIds.push(...jobRows.map((row) => row.id))

    expect(userRows).toEqual([
      { id: userId, status: 'deleted', defaultTeamId: null },
    ])
    expect(teamRows).toEqual([{ status: 'deleted' }])
    expect(projectRows).toEqual([{ status: 'deleted' }])
    expect(serverRows).toEqual([{ status: 'deleted' }])
    expect(deploymentRows).toEqual([
      {
        status: 'canceled',
        phase: 'canceled',
        errorMessage: 'Canceled because the owning user was deleted.',
      },
    ])
    expect(hostnameRows).toEqual([])
    expect(inviteRows).toEqual([])
    expect(accountRows).toEqual([])
    expect(sessionRows).toEqual([])
    expect(jobRows).toHaveLength(2)
    const deprovisionJob = jobRows.find((job) => job.type === 'deprovision')
    const purgeJob = jobRows.find((job) => job.type === 'purge')

    expect(deprovisionJob).toMatchObject({
      status: 'queued',
      type: 'deprovision',
      payload: {
        schemaVersion: 1,
        reason: 'Team deleted because the owning user was deleted.',
        runtimeIds: ['owned-runtime'],
      },
    })
    expect(deprovisionJob?.payload).toMatchObject({ removeVolumes: false })
    expect(purgeJob).toMatchObject({
      status: 'queued',
      type: 'purge',
      payload: {
        schemaVersion: 1,
        runtimeIds: ['owned-runtime'],
        removeVolumes: true,
      },
    })
    expect(purgeJob?.availableAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('leaveTeam integration', () => {
  test('blocks leaving the default team', async () => {
    const userId = makeId('user')
    const teamId = makeId('team')
    touchedUserIds.push(userId)
    touchedTeamIds.push(teamId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(teams).values({
      id: teamId,
      name: 'Default team',
      slug: makeSlug(teamId),
    })
    await db
      .update(user)
      .set({ defaultTeamId: teamId })
      .where(eq(user.id, userId))
    await db.insert(teamMembers).values({
      id: makeId('member'),
      role: 'owner',
      teamId,
      userId,
    })

    await expect(leaveTeam({ userId, teamId })).rejects.toThrow(
      'You cannot leave your default team.',
    )

    const membershipRows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))

    expect(membershipRows).toEqual([{ userId }])
  })

  test('blocks owners from leaving when no other owner remains', async () => {
    const ownerId = makeId('user')
    const memberId = makeId('user')
    const defaultTeamId = makeId('team')
    const teamId = makeId('team')
    touchedUserIds.push(ownerId, memberId)
    touchedTeamIds.push(defaultTeamId, teamId)

    await db
      .insert(user)
      .values([
        makeUser(ownerId, `${ownerId}@example.com`),
        makeUser(memberId, `${memberId}@example.com`),
      ])
    await db.insert(teams).values([
      {
        id: defaultTeamId,
        name: 'Default team',
        slug: makeSlug(defaultTeamId),
      },
      {
        id: teamId,
        name: 'Shared team',
        slug: makeSlug(teamId),
      },
    ])
    await db.update(user).set({ defaultTeamId }).where(eq(user.id, ownerId))
    await db.insert(teamMembers).values([
      {
        id: makeId('member'),
        role: 'owner',
        teamId: defaultTeamId,
        userId: ownerId,
      },
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId: ownerId,
      },
      {
        id: makeId('member'),
        role: 'member',
        teamId,
        userId: memberId,
      },
    ])

    await expect(leaveTeam({ userId: ownerId, teamId })).rejects.toThrow(
      'There must be at least one owner.',
    )

    const membershipRows = await db
      .select({ userId: teamMembers.userId, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))

    expect(
      new Map(membershipRows.map((row) => [row.userId, row.role])),
    ).toEqual(
      new Map([
        [ownerId, 'owner'],
        [memberId, 'member'],
      ]),
    )
  })

  test('allows owners to leave when another owner remains', async () => {
    const ownerId = makeId('user')
    const otherOwnerId = makeId('user')
    const defaultTeamId = makeId('team')
    const teamId = makeId('team')
    touchedUserIds.push(ownerId, otherOwnerId)
    touchedTeamIds.push(defaultTeamId, teamId)

    await db
      .insert(user)
      .values([
        makeUser(ownerId, `${ownerId}@example.com`),
        makeUser(otherOwnerId, `${otherOwnerId}@example.com`),
      ])
    await db.insert(teams).values([
      {
        id: defaultTeamId,
        name: 'Default team',
        slug: makeSlug(defaultTeamId),
      },
      {
        id: teamId,
        name: 'Shared team',
        slug: makeSlug(teamId),
      },
    ])
    await db.update(user).set({ defaultTeamId }).where(eq(user.id, ownerId))
    await db.insert(teamMembers).values([
      {
        id: makeId('member'),
        role: 'owner',
        teamId: defaultTeamId,
        userId: ownerId,
      },
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId: ownerId,
      },
      {
        id: makeId('member'),
        role: 'owner',
        teamId,
        userId: otherOwnerId,
      },
    ])

    const teamsAfterLeave = await leaveTeam({ userId: ownerId, teamId })

    const membershipRows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))

    expect(membershipRows).toEqual([{ userId: otherOwnerId }])
    expect(teamsAfterLeave.map((team) => team.id)).toEqual([defaultTeamId])
  })
})

describe('disconnectAuthAccount integration', () => {
  test('respects the configured last sign-in method policy', async () => {
    const userId = makeId('user')
    const accountId = makeId('account')
    touchedUserIds.push(userId)
    touchedAccountIds.push(accountId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(account).values({
      id: accountId,
      accountId: 'github-account',
      providerId: 'github',
      userId,
    })

    const result = disconnectAuthAccount({
      userId,
      providerId: 'github',
      accountId: 'github-account',
    })

    if (authMethods.email) {
      await expect(result).resolves.toEqual([])
    } else {
      await expect(result).rejects.toThrow(
        'Connect another sign-in method before disconnecting this account.',
      )
    }
  })

  test('allows disconnecting one social account when another remains', async () => {
    const userId = makeId('user')
    const githubAccountId = makeId('account')
    const googleAccountId = makeId('account')
    touchedUserIds.push(userId)
    touchedAccountIds.push(githubAccountId, googleAccountId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(account).values([
      {
        id: githubAccountId,
        accountId: 'github-account',
        providerId: 'github',
        userId,
      },
      {
        id: googleAccountId,
        accountId: 'google-account',
        providerId: 'google',
        userId,
      },
    ])

    const remainingAccounts = await disconnectAuthAccount({
      userId,
      providerId: 'github',
      accountId: 'github-account',
    })

    expect(remainingAccounts.map((row) => row.providerId)).toEqual(['google'])
  })
})

describe('backfillAuthAccountIdentities integration', () => {
  test('backfills missing GitHub provider identity from account tokens', async () => {
    const userId = makeId('user')
    const accountId = makeId('account')
    touchedUserIds.push(userId)
    touchedAccountIds.push(accountId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(account).values({
      id: accountId,
      accountId: 'github-account',
      accessToken: 'github-token',
      providerId: 'github',
      userId,
    })

    const fetchedUrls: Array<string> = []
    const accounts = await backfillAuthAccountIdentities({
      userId,
      fetcher: async (input) => {
        const url = input.toString()
        fetchedUrls.push(url)

        if (url === 'https://api.github.com/user') {
          return Response.json({
            id: 123,
            login: 'octocat',
            name: 'Octo Cat',
            email: null,
            avatar_url: 'https://avatars.example/octocat.png',
          })
        }

        if (url === 'https://api.github.com/user/emails') {
          return Response.json([
            {
              email: 'backup@example.com',
              primary: false,
              verified: true,
            },
            {
              email: 'octocat@example.com',
              primary: true,
              verified: true,
            },
          ])
        }

        return new Response(null, { status: 404 })
      },
    })

    expect(fetchedUrls).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/user/emails',
    ])
    expect(accounts).toEqual([
      {
        id: accountId,
        accountId: 'github-account',
        providerId: 'github',
        managementUrl: null,
        providerAccountName: 'Octo Cat',
        providerAccountEmail: 'octocat@example.com',
        providerAccountUsername: 'octocat',
        providerAccountImage: 'https://avatars.example/octocat.png',
      },
    ])
    expect(accounts[0]).not.toHaveProperty('accessToken')
  })

  test('preserves existing provider identity fields when backfilling', async () => {
    const userId = makeId('user')
    const accountId = makeId('account')
    touchedUserIds.push(userId)
    touchedAccountIds.push(accountId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(account).values({
      id: accountId,
      accountId: 'github-account',
      accessToken: 'github-token',
      providerAccountName: 'Existing Name',
      providerId: 'github',
      userId,
    })

    const accounts = await backfillAuthAccountIdentities({
      userId,
      fetcher: async (input) => {
        if (input.toString() === 'https://api.github.com/user') {
          return Response.json({
            id: 123,
            login: 'new-login',
            name: 'New Name',
            email: 'new@example.com',
            avatar_url: 'https://avatars.example/new.png',
          })
        }

        return Response.json([])
      },
    })

    expect(accounts).toEqual([
      {
        id: accountId,
        accountId: 'github-account',
        providerId: 'github',
        managementUrl: null,
        providerAccountName: 'Existing Name',
        providerAccountEmail: 'new@example.com',
        providerAccountUsername: 'new-login',
        providerAccountImage: 'https://avatars.example/new.png',
      },
    ])
  })

  test('backfills missing Google provider identity from the id token', async () => {
    const userId = makeId('user')
    const accountId = makeId('account')
    touchedUserIds.push(userId)
    touchedAccountIds.push(accountId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))
    await db.insert(account).values({
      id: accountId,
      accountId: 'google-account',
      idToken: makeJwt({
        email: 'ronan@example.com',
        name: 'Ronan Berder',
        picture: 'https://accounts.example/ronan.png',
      }),
      providerId: 'google',
      userId,
    })

    const accounts = await backfillAuthAccountIdentities({
      userId,
      fetcher: async () => {
        throw new Error('Google backfill should not fetch provider APIs.')
      },
    })

    expect(accounts).toEqual([
      {
        id: accountId,
        accountId: 'google-account',
        providerId: 'google',
        managementUrl: 'https://myaccount.google.com/connections',
        providerAccountName: 'Ronan Berder',
        providerAccountEmail: 'ronan@example.com',
        providerAccountUsername: 'ronan@example.com',
        providerAccountImage: 'https://accounts.example/ronan.png',
      },
    ])
  })
})

describe('email change integration', () => {
  test('verifies a pending email change token', async () => {
    const userId = makeId('user')
    const oldEmail = `${userId}@example.com`
    const newEmail = `${userId}+new@example.com`
    touchedUserIds.push(userId)

    await db.insert(user).values(makeUser(userId, oldEmail))

    const token = await createEmailVerificationToken({
      email: oldEmail,
      updateTo: newEmail,
      requestType: 'change-email-verification',
    })

    await auth.api.verifyEmail({
      query: {
        token,
      },
    })

    const rows = await db
      .select({ email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))

    expect(rows).toEqual([{ email: newEmail, emailVerified: true }])
  })
})

describe('updateUserGeneral integration', () => {
  test('updates name and username', async () => {
    const userId = makeId('user')
    touchedUserIds.push(userId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))

    const result = await updateUserGeneral({
      userId,
      name: 'Updated User',
      username: 'updated-user',
    })

    const rows = await db
      .select({ name: user.name, username: user.username })
      .from(user)
      .where(eq(user.id, userId))

    expect(result).toMatchObject({
      id: userId,
      name: 'Updated User',
      username: 'updated-user',
    })
    expect(rows).toEqual([{ name: 'Updated User', username: 'updated-user' }])
  })

  test('rejects duplicate usernames case-insensitively', async () => {
    const userId = makeId('user')
    const otherUserId = makeId('user')
    touchedUserIds.push(userId, otherUserId)

    await db
      .insert(user)
      .values([
        makeUser(userId, `${userId}@example.com`, 'primary-user'),
        makeUser(otherUserId, `${otherUserId}@example.com`, 'taken-name'),
      ])

    await expect(
      updateUserGeneral({
        userId,
        name: 'Primary User',
        username: 'Taken-Name',
      }),
    ).rejects.toThrow('Username is already taken.')
  })

  test('allows reusing usernames from deleted users', async () => {
    const userId = makeId('user')
    const deletedUserId = makeId('user')
    touchedUserIds.push(userId, deletedUserId)

    await db.insert(user).values([
      makeUser(userId, `${userId}@example.com`, 'primary-user'),
      {
        ...makeUser(
          deletedUserId,
          `${deletedUserId}@example.com`,
          'released-name',
        ),
        status: 'deleted' as const,
      },
    ])

    await expect(
      updateUserGeneral({
        userId,
        name: 'Primary User',
        username: 'released-name',
      }),
    ).resolves.toMatchObject({ username: 'released-name' })
  })

  test('rejects invalid usernames before updating', async () => {
    const userId = makeId('user')
    touchedUserIds.push(userId)

    await db.insert(user).values(makeUser(userId, `${userId}@example.com`))

    await expect(
      updateUserGeneral({
        userId,
        name: 'Invalid User',
        username: '-invalid',
      }),
    ).rejects.toThrow('Username must start and end')
  })
})

async function createUserWithTeams({
  activeTeamCount,
  deletedTeamCount,
}: {
  activeTeamCount: number
  deletedTeamCount: number
}) {
  const userId = makeId('user')
  touchedUserIds.push(userId)

  await db.insert(user).values(makeUser(userId, `${userId}@example.com`))

  const activeTeamIds = Array.from({ length: activeTeamCount }, () =>
    makeId('team'),
  )
  const deletedTeamIds = Array.from({ length: deletedTeamCount }, () =>
    makeId('team'),
  )
  const teamIds = [...activeTeamIds, ...deletedTeamIds]
  touchedTeamIds.push(...teamIds)

  await db.insert(teams).values([
    ...activeTeamIds.map((teamId) => ({
      id: teamId,
      name: 'Active team',
      slug: makeSlug(teamId),
      status: 'active' as const,
    })),
    ...deletedTeamIds.map((teamId) => ({
      id: teamId,
      name: 'Deleted team',
      slug: makeSlug(teamId),
      status: 'deleted' as const,
    })),
  ])
  await db.insert(teamMembers).values(
    teamIds.map((teamId) => ({
      id: makeId('member'),
      role: 'owner' as const,
      teamId,
      userId,
    })),
  )
  await db
    .update(user)
    .set({ defaultTeamId: activeTeamIds.at(0) ?? null })
    .where(eq(user.id, userId))

  return {
    activeTeamId: required(activeTeamIds[0]),
    deletedTeamId: required(deletedTeamIds[0]),
    userId,
  }
}

async function cleanupRows() {
  if (touchedAccountIds.length > 0) {
    await db.delete(account).where(inArray(account.id, touchedAccountIds))
  }

  if (touchedJobIds.length > 0) {
    await db.delete(agentJobs).where(inArray(agentJobs.id, touchedJobIds))
  }

  if (touchedCleanupJobIds.length > 0) {
    await db
      .delete(userCleanupJobs)
      .where(inArray(userCleanupJobs.id, touchedCleanupJobIds))
  }

  if (touchedHostnameIds.length > 0) {
    await db.delete(aliases).where(inArray(aliases.id, touchedHostnameIds))
  }

  if (touchedDeploymentIds.length > 0) {
    await db
      .delete(deployments)
      .where(inArray(deployments.id, touchedDeploymentIds))
  }

  if (touchedEnvironmentIds.length > 0) {
    await db
      .delete(environments)
      .where(inArray(environments.id, touchedEnvironmentIds))
  }

  if (touchedTeamIds.length > 0) {
    await db
      .delete(teamMembers)
      .where(inArray(teamMembers.teamId, touchedTeamIds))
  }

  if (touchedInviteIds.length > 0) {
    await db
      .delete(teamInvites)
      .where(inArray(teamInvites.id, touchedInviteIds))
  }

  if (touchedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, touchedUserIds))
  }

  if (touchedProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, touchedProjectIds))
  }

  if (touchedServerIds.length > 0) {
    await db.delete(servers).where(inArray(servers.id, touchedServerIds))
  }

  if (touchedSessionIds.length > 0) {
    await db.delete(session).where(inArray(session.id, touchedSessionIds))
  }

  if (touchedTeamIds.length > 0) {
    await db.delete(teams).where(inArray(teams.id, touchedTeamIds))
  }

  touchedAccountIds.length = 0
  touchedCleanupJobIds.length = 0
  touchedJobIds.length = 0
  touchedHostnameIds.length = 0
  touchedDeploymentIds.length = 0
  touchedEnvironmentIds.length = 0
  touchedProjectIds.length = 0
  touchedServerIds.length = 0
  touchedSessionIds.length = 0
  touchedInviteIds.length = 0
  touchedUserIds.length = 0
  touchedTeamIds.length = 0
}

function makeUser(id: string, email: string, username = makeUsername(id)) {
  return {
    id,
    email,
    emailVerified: true,
    name: id,
    username,
  }
}

function makeId(prefix: string) {
  return `it-${prefix}-${crypto.randomUUID()}`
}

function makeSlug(id: string) {
  return id.replaceAll('_', '-').toLowerCase()
}

function makeUsername(id: string) {
  return id.replaceAll('_', '-').toLowerCase().slice(0, 50)
}

function makeJwt(claims: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    '',
  ].join('.')
}

async function createEmailVerificationToken(
  payload: Record<string, unknown> & { email: string; updateTo?: string },
) {
  return new SignJWT({
    ...payload,
    email: payload.email.toLowerCase(),
    updateTo: payload.updateTo?.toLowerCase(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode(config.BETTER_AUTH_SECRET))
}
