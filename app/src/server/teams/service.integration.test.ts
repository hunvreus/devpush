import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { closeDb, db } from '@/server/db'
import { teamInvites, teamMembers, teams, user } from '@/server/db/schema'
import { removePublicFile } from '@/server/uploads/avatar'
import {
  acceptTeamInvite,
  acceptUserTeamInvite,
  cleanupExpiredTeamInvites,
  createTeamInvite,
  deleteTeam,
  listTeamInvites,
  listUserPendingTeamInvites,
  removeTeamMember,
  resendTeamInvite,
  revokeTeamInvite,
  transferTeamOwnership,
  updateTeamGeneral,
  updateTeamMemberRole,
} from './service'

const touchedInviteIds: Array<string> = []
const touchedAvatarPaths: Array<string> = []
const touchedTeamIds: Array<string> = []
const touchedUserIds: Array<string> = []

afterEach(async () => {
  await cleanupRows()
})

afterAll(async () => {
  await closeDb()
})

describe('team settings integration', () => {
  test('allows admins to update general settings and invite members', async () => {
    const { adminId, teamId, teamSlug } = await createTeamWithMembers()
    const nextSlug = `${teamSlug}-updated`

    const updatedTeam = await updateTeamGeneral({
      userId: adminId,
      teamSlug,
      name: 'Updated team',
      slug: nextSlug,
    })
    const inviteResult = await createTeamInvite({
      userId: adminId,
      teamSlug: nextSlug,
      email: `${makeId('invite')}@example.com`,
      role: 'member',
    })
    touchedInviteIds.push(...inviteResult.invites.map((invite) => invite.id))

    const teamRows = await db
      .select({ name: teams.name, slug: teams.slug })
      .from(teams)
      .where(eq(teams.id, teamId))

    expect(updatedTeam.slug).toBe(nextSlug)
    expect(teamRows).toEqual([{ name: 'Updated team', slug: nextSlug }])
    expect(inviteResult.invites).toHaveLength(1)
  })

  test('blocks members from team settings while admins can manage members', async () => {
    const { adminId, memberId, otherOwnerId, teamSlug } =
      await createTeamWithMembers()

    await expect(
      updateTeamGeneral({
        userId: memberId,
        teamSlug,
        name: 'Nope',
        slug: `${teamSlug}-nope`,
      }),
    ).rejects.toThrow('You do not have permission')

    await expect(
      createTeamInvite({
        userId: memberId,
        teamSlug,
        email: `${makeId('invite')}@example.com`,
        role: 'member',
      }),
    ).rejects.toThrow('You do not have permission')

    await expect(
      updateTeamMemberRole({
        userId: memberId,
        teamSlug,
        memberUserId: otherOwnerId,
        role: 'admin',
      }),
    ).rejects.toThrow('Only team owners and admins')

    await updateTeamMemberRole({
      userId: adminId,
      teamSlug,
      memberUserId: memberId,
      role: 'admin',
    })

    const memberRows = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.userId, memberId))

    expect(memberRows).toEqual([{ role: 'admin' }])
  })

  test('blocks removing or demoting the last owner', async () => {
    const { ownerId, teamSlug } = await createTeamWithMembers({
      includeSecondOwner: false,
    })

    await expect(
      updateTeamMemberRole({
        userId: ownerId,
        teamSlug,
        memberUserId: ownerId,
        role: 'admin',
      }),
    ).rejects.toThrow('There must be at least one owner.')

    await expect(
      removeTeamMember({
        userId: ownerId,
        teamSlug,
        memberUserId: ownerId,
      }),
    ).rejects.toThrow('There must be at least one owner.')
  })

  test('blocks admins from granting, revoking, or removing owner access', async () => {
    const { adminId, memberId, otherOwnerId, teamSlug } =
      await createTeamWithMembers()

    await expect(
      updateTeamMemberRole({
        userId: adminId,
        teamSlug,
        memberUserId: memberId,
        role: 'owner',
      }),
    ).rejects.toThrow('Only team owners can manage owner roles.')

    await expect(
      updateTeamMemberRole({
        userId: adminId,
        teamSlug,
        memberUserId: otherOwnerId,
        role: 'admin',
      }),
    ).rejects.toThrow('Only team owners can manage owner roles.')

    await expect(
      removeTeamMember({
        userId: adminId,
        teamSlug,
        memberUserId: otherOwnerId,
      }),
    ).rejects.toThrow('Only team owners can remove owners.')
  })

  test('allows owners to manage owner access when another owner remains', async () => {
    const { memberId, otherOwnerId, ownerId, teamSlug } =
      await createTeamWithMembers()

    await updateTeamMemberRole({
      userId: ownerId,
      teamSlug,
      memberUserId: memberId,
      role: 'owner',
    })
    await updateTeamMemberRole({
      userId: ownerId,
      teamSlug,
      memberUserId: otherOwnerId,
      role: 'admin',
    })

    const memberRows = await db
      .select({ userId: teamMembers.userId, role: teamMembers.role })
      .from(teamMembers)
      .where(inArray(teamMembers.userId, [memberId, otherOwnerId]))

    expect(new Map(memberRows.map((row) => [row.userId, row.role]))).toEqual(
      new Map([
        [memberId, 'owner'],
        [otherOwnerId, 'admin'],
      ]),
    )
  })

  test('transfers ownership to another member and demotes the acting owner', async () => {
    const { memberId, ownerId, teamSlug } = await createTeamWithMembers({
      includeSecondOwner: false,
    })

    await transferTeamOwnership({
      userId: ownerId,
      teamSlug,
      memberUserId: memberId,
    })

    const memberRows = await db
      .select({ userId: teamMembers.userId, role: teamMembers.role })
      .from(teamMembers)
      .where(inArray(teamMembers.userId, [ownerId, memberId]))

    expect(new Map(memberRows.map((row) => [row.userId, row.role]))).toEqual(
      new Map([
        [ownerId, 'admin'],
        [memberId, 'owner'],
      ]),
    )
  })

  test('blocks invalid ownership transfers', async () => {
    const { adminId, memberId, ownerId, teamSlug } =
      await createTeamWithMembers()

    await expect(
      transferTeamOwnership({
        userId: adminId,
        teamSlug,
        memberUserId: memberId,
      }),
    ).rejects.toThrow('Only team owners can manage this team.')

    await expect(
      transferTeamOwnership({
        userId: ownerId,
        teamSlug,
        memberUserId: ownerId,
      }),
    ).rejects.toThrow('Choose another member to transfer ownership to.')

    await expect(
      transferTeamOwnership({
        userId: ownerId,
        teamSlug,
        memberUserId: makeId('user'),
      }),
    ).rejects.toThrow('Member not found.')
  })

  test('blocks deleting a team that is another active user default team', async () => {
    const { adminId, ownerId, teamId, teamSlug } = await createTeamWithMembers()

    await db
      .update(user)
      .set({ defaultTeamId: teamId })
      .where(eq(user.id, adminId))

    await expect(
      deleteTeam({
        userId: ownerId,
        teamSlug,
        confirmationName: teamSlug,
        ignoreDefaultForUserId: ownerId,
      }),
    ).rejects.toThrow('You cannot delete a default team.')

    const teamRows = await db
      .select({ status: teams.status })
      .from(teams)
      .where(eq(teams.id, teamId))

    expect(teamRows).toEqual([{ status: 'active' }])
  })

  test('blocks deleting the current user default team from team settings', async () => {
    const { ownerId, teamId, teamSlug } = await createTeamWithMembers()

    await db
      .update(user)
      .set({ defaultTeamId: teamId })
      .where(eq(user.id, ownerId))

    await expect(
      deleteTeam({
        userId: ownerId,
        teamSlug,
        confirmationName: teamSlug,
      }),
    ).rejects.toThrow('You cannot delete a default team.')

    const statusRows = await db
      .select({ status: teams.status })
      .from(teams)
      .where(eq(teams.id, teamId))

    expect(statusRows).toEqual([{ status: 'active' }])
  })

  test('lists only pending non-expired invites', async () => {
    const { ownerId, teamId, teamSlug } = await createTeamWithMembers()
    const active = await createTeamInvite({
      userId: ownerId,
      teamSlug,
      email: `${makeId('active')}@example.com`,
      role: 'member',
    })
    touchedInviteIds.push(...active.invites.map((invite) => invite.id))

    const expiredInviteId = makeId('invite')
    touchedInviteIds.push(expiredInviteId)
    await db.insert(teamInvites).values({
      id: expiredInviteId,
      email: `${makeId('expired')}@example.com`,
      expiresAt: new Date(Date.now() - 60_000),
      role: 'member',
      teamId,
      tokenHash: makeId('token'),
    })

    const invites = await listTeamInvites(teamId)

    expect(invites).toHaveLength(1)
    expect(invites[0]?.id).toBe(active.invites[0]?.id)
  })

  test('reports duplicate pending invites without masking other failures', async () => {
    const { ownerId, teamSlug } = await createTeamWithMembers()
    const email = `${makeId('duplicate')}@example.com`
    const first = await createTeamInvite({
      userId: ownerId,
      teamSlug,
      email,
      role: 'member',
    })
    touchedInviteIds.push(...first.invites.map((invite) => invite.id))

    await expect(
      createTeamInvite({
        userId: ownerId,
        teamSlug,
        email,
        role: 'admin',
      }),
    ).rejects.toThrow(`Invitation already sent to ${email}.`)
  })

  test('replaces expired pending invites for the same email', async () => {
    const { ownerId, teamId, teamSlug } = await createTeamWithMembers()
    const email = `${makeId('expired-reinvite')}@example.com`
    const expiredInviteId = makeId('invite')
    touchedInviteIds.push(expiredInviteId)
    await db.insert(teamInvites).values({
      id: expiredInviteId,
      email,
      expiresAt: new Date(Date.now() - 60_000),
      role: 'member',
      teamId,
      tokenHash: makeId('token'),
    })

    const result = await createTeamInvite({
      userId: ownerId,
      teamSlug,
      email,
      role: 'admin',
    })
    touchedInviteIds.push(...result.invites.map((invite) => invite.id))

    const inviteRows = await db
      .select({
        id: teamInvites.id,
        role: teamInvites.role,
        expiresAt: teamInvites.expiresAt,
      })
      .from(teamInvites)
      .where(eq(teamInvites.id, expiredInviteId))

    expect(inviteRows).toHaveLength(1)
    expect(inviteRows[0]?.id).toBe(expiredInviteId)
    expect(inviteRows[0]?.role).toBe('admin')
    expect(inviteRows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(result.invites.map((invite) => invite.id)).toContain(expiredInviteId)
  })

  test('resends a pending invite in place', async () => {
    const { ownerId, teamSlug } = await createTeamWithMembers()
    const first = await createTeamInvite({
      userId: ownerId,
      teamSlug,
      email: `${makeId('resend')}@example.com`,
      role: 'member',
    })
    const inviteId = first.invites.at(0)?.id ?? ''
    touchedInviteIds.push(...first.invites.map((invite) => invite.id))
    const beforeRows = await db
      .select({
        expiresAt: teamInvites.expiresAt,
        tokenHash: teamInvites.tokenHash,
      })
      .from(teamInvites)
      .where(eq(teamInvites.id, inviteId))

    const result = await resendTeamInvite({
      userId: ownerId,
      teamSlug,
      inviteId,
    })
    const afterRows = await db
      .select({
        expiresAt: teamInvites.expiresAt,
        tokenHash: teamInvites.tokenHash,
      })
      .from(teamInvites)
      .where(eq(teamInvites.id, inviteId))

    expect(result.invites.map((invite) => invite.id)).toContain(inviteId)
    expect(afterRows.at(0)?.tokenHash).not.toBe(beforeRows.at(0)?.tokenHash)
    expect(afterRows.at(0)?.expiresAt.getTime()).toBeGreaterThan(
      beforeRows.at(0)?.expiresAt.getTime() ?? 0,
    )
  })

  test('rejects revoking missing or inactive invites', async () => {
    const { ownerId, teamId, teamSlug } = await createTeamWithMembers()
    const revokedInviteId = makeId('invite')
    touchedInviteIds.push(revokedInviteId)
    await db.insert(teamInvites).values({
      id: revokedInviteId,
      email: `${makeId('revoked')}@example.com`,
      expiresAt: new Date(Date.now() + 86_400_000),
      role: 'member',
      status: 'revoked',
      teamId,
      tokenHash: makeId('token'),
    })

    await expect(
      revokeTeamInvite({
        userId: ownerId,
        teamSlug,
        inviteId: makeId('invite'),
      }),
    ).rejects.toThrow('Invite not found.')
    await expect(
      revokeTeamInvite({
        userId: ownerId,
        teamSlug,
        inviteId: revokedInviteId,
      }),
    ).rejects.toThrow('Invite not found.')

    const inviteRows = await db
      .select({ status: teamInvites.status })
      .from(teamInvites)
      .where(eq(teamInvites.id, revokedInviteId))

    expect(inviteRows).toEqual([{ status: 'revoked' }])
  })

  test('marks only expired pending invites as expired during cleanup', async () => {
    const { teamId } = await createTeamWithMembers()
    const pendingExpiredId = makeId('invite')
    const pendingActiveId = makeId('invite')
    const acceptedExpiredId = makeId('invite')
    const revokedExpiredId = makeId('invite')
    const now = new Date('2026-06-28T00:00:00.000Z')
    touchedInviteIds.push(
      pendingExpiredId,
      pendingActiveId,
      acceptedExpiredId,
      revokedExpiredId,
    )

    await db.insert(teamInvites).values([
      {
        id: pendingExpiredId,
        email: `${makeId('pending-expired')}@example.com`,
        expiresAt: new Date(now.getTime() - 1_000),
        role: 'member',
        status: 'pending',
        teamId,
        tokenHash: makeId('token'),
      },
      {
        id: pendingActiveId,
        email: `${makeId('pending-active')}@example.com`,
        expiresAt: new Date(now.getTime() + 1_000),
        role: 'member',
        status: 'pending',
        teamId,
        tokenHash: makeId('token'),
      },
      {
        id: acceptedExpiredId,
        email: `${makeId('accepted-expired')}@example.com`,
        expiresAt: new Date(now.getTime() - 1_000),
        role: 'member',
        status: 'accepted',
        teamId,
        tokenHash: makeId('token'),
      },
      {
        id: revokedExpiredId,
        email: `${makeId('revoked-expired')}@example.com`,
        expiresAt: new Date(now.getTime() - 1_000),
        role: 'member',
        status: 'revoked',
        teamId,
        tokenHash: makeId('token'),
      },
    ])

    const result = await cleanupExpiredTeamInvites({ now })
    const inviteRows = await db
      .select({
        id: teamInvites.id,
        status: teamInvites.status,
        updatedAt: teamInvites.updatedAt,
      })
      .from(teamInvites)
      .where(
        inArray(teamInvites.id, [
          pendingExpiredId,
          pendingActiveId,
          acceptedExpiredId,
          revokedExpiredId,
        ]),
      )

    expect(result).toEqual({
      expiredCount: 1,
      expiredInviteIds: [pendingExpiredId],
    })
    expect(
      new Map(inviteRows.map((invite) => [invite.id, invite.status])),
    ).toEqual(
      new Map([
        [pendingExpiredId, 'expired'],
        [pendingActiveId, 'pending'],
        [acceptedExpiredId, 'accepted'],
        [revokedExpiredId, 'revoked'],
      ]),
    )
    expect(
      inviteRows.find((invite) => invite.id === pendingExpiredId)?.updatedAt,
    ).toEqual(now)
  })

  test('rejects invalid team invite acceptance states', async () => {
    const { ownerId, teamSlug } = await createTeamWithMembers()
    const invitedUserId = makeId('user')
    const wrongUserId = makeId('user')
    const unverifiedUserId = makeId('user')
    touchedUserIds.push(invitedUserId, wrongUserId, unverifiedUserId)

    await db
      .insert(user)
      .values([
        makeUser(invitedUserId, 'invited-expired@example.com'),
        makeUser(wrongUserId, 'wrong@example.com'),
        makeUser(unverifiedUserId, 'unverified@example.com', false),
      ])

    const wrongEmailToken = await inviteAndGetToken({
      ownerId,
      teamSlug,
      email: 'invited@example.com',
    })
    await expect(
      acceptTeamInvite({ userId: wrongUserId, token: wrongEmailToken }),
    ).rejects.toThrow('Sign in with the invited email address to accept.')

    const unverifiedToken = await inviteAndGetToken({
      ownerId,
      teamSlug,
      email: 'unverified@example.com',
    })
    await expect(
      acceptTeamInvite({ userId: unverifiedUserId, token: unverifiedToken }),
    ).rejects.toThrow('Verify your email address before accepting this invite.')

    const expiredToken = await inviteAndGetToken({
      ownerId,
      teamSlug,
      email: 'invited-expired@example.com',
    })
    await db
      .update(teamInvites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(teamInvites.email, 'invited-expired@example.com'))
    await expect(
      acceptTeamInvite({ userId: invitedUserId, token: expiredToken }),
    ).rejects.toThrow('Invalid or expired invitation.')

    const revokedUserId = makeId('user')
    touchedUserIds.push(revokedUserId)
    await db
      .insert(user)
      .values(makeUser(revokedUserId, 'invited-revoked@example.com'))
    const revokedToken = await inviteAndGetToken({
      ownerId,
      teamSlug,
      email: 'invited-revoked@example.com',
    })
    await db
      .update(teamInvites)
      .set({ status: 'revoked' })
      .where(eq(teamInvites.email, 'invited-revoked@example.com'))
    await expect(
      acceptTeamInvite({ userId: revokedUserId, token: revokedToken }),
    ).rejects.toThrow('Invalid or expired invitation.')
  })

  test('accepting an invite is idempotent for existing members', async () => {
    const { ownerId, teamId, teamSlug } = await createTeamWithMembers()
    const invitedUserId = makeId('user')
    touchedUserIds.push(invitedUserId)

    await db.insert(user).values(makeUser(invitedUserId, 'invited@example.com'))
    const token = await inviteAndGetToken({
      ownerId,
      teamSlug,
      email: 'invited@example.com',
    })
    await db.insert(teamMembers).values({
      id: makeId('member'),
      role: 'member',
      teamId,
      userId: invitedUserId,
    })

    await expect(
      acceptTeamInvite({ userId: invitedUserId, token }),
    ).resolves.toBe(teamSlug)

    const membershipRows = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, invitedUserId),
        ),
      )
    const inviteRows = await db
      .select({ status: teamInvites.status })
      .from(teamInvites)
      .where(eq(teamInvites.email, 'invited@example.com'))

    expect(membershipRows).toHaveLength(1)
    expect(inviteRows).toEqual([{ status: 'accepted' }])
  })

  test('lists and accepts pending invites for the current user', async () => {
    const { ownerId, teamId, teamSlug } = await createTeamWithMembers()
    const invitedUserId = makeId('user')
    touchedUserIds.push(invitedUserId)

    await db.insert(user).values(makeUser(invitedUserId, 'pending@example.com'))

    const inviteResult = await createTeamInvite({
      userId: ownerId,
      teamSlug,
      email: 'pending@example.com',
      role: 'admin',
    })
    const inviteId = inviteResult.invites.at(0)?.id
    expect(inviteId).toBeTruthy()
    touchedInviteIds.push(...inviteResult.invites.map((invite) => invite.id))

    const pendingInvites = await listUserPendingTeamInvites(invitedUserId)

    expect(pendingInvites).toHaveLength(1)
    expect(pendingInvites[0]).toMatchObject({
      id: inviteId,
      role: 'admin',
      team: {
        id: teamId,
        slug: teamSlug,
      },
      inviter: {
        id: ownerId,
      },
    })

    await expect(
      acceptUserTeamInvite({ userId: invitedUserId, inviteId: inviteId ?? '' }),
    ).resolves.toBe(teamSlug)

    const membershipRows = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, invitedUserId),
        ),
      )
    const acceptedInvites = await listUserPendingTeamInvites(invitedUserId)

    expect(membershipRows).toEqual([{ role: 'admin' }])
    expect(acceptedInvites).toEqual([])
  })

  test('rejects accepting another user pending invite by id', async () => {
    const { ownerId, teamSlug } = await createTeamWithMembers()
    const invitedUserId = makeId('user')
    const wrongUserId = makeId('user')
    touchedUserIds.push(invitedUserId, wrongUserId)

    await db
      .insert(user)
      .values([
        makeUser(invitedUserId, 'pending-other@example.com'),
        makeUser(wrongUserId, 'wrong-pending@example.com'),
      ])

    const inviteResult = await createTeamInvite({
      userId: ownerId,
      teamSlug,
      email: 'pending-other@example.com',
      role: 'member',
    })
    const inviteId = inviteResult.invites.at(0)?.id ?? ''
    touchedInviteIds.push(...inviteResult.invites.map((invite) => invite.id))

    await expect(
      acceptUserTeamInvite({ userId: wrongUserId, inviteId }),
    ).rejects.toThrow('Sign in with the invited email address to accept.')
  })

  test('does not keep a newly uploaded avatar when a team slug update fails', async () => {
    const { adminId, teamId, teamSlug } = await createTeamWithMembers()
    const otherTeamId = makeId('team')
    const otherTeamSlug = makeSlug(otherTeamId)
    touchedTeamIds.push(otherTeamId)

    await db.insert(teams).values({
      id: otherTeamId,
      name: 'Other team',
      slug: otherTeamSlug,
    })

    await expect(
      updateTeamGeneral({
        userId: adminId,
        teamSlug,
        name: 'Renamed team',
        slug: otherTeamSlug,
        avatarDataUrl: makeAvatarDataUrl(),
      }),
    ).rejects.toThrow('A team with this slug already exists.')

    const avatarPath = `/uploads/avatars/team_${teamId}.png`
    const avatarRows = await db
      .select({ avatarPath: teams.avatarPath })
      .from(teams)
      .where(eq(teams.id, teamId))

    expect(avatarRows).toEqual([{ avatarPath: null }])
    await expectAvatarMissing(avatarPath)
  })

  test('rejects unsupported and oversized team avatars', async () => {
    const { adminId, teamId, teamSlug } = await createTeamWithMembers()

    await expect(
      updateTeamGeneral({
        userId: adminId,
        teamSlug,
        name: 'Team with invalid avatar',
        slug: teamSlug,
        avatarDataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg />').toString('base64')}`,
      }),
    ).rejects.toThrow('Upload a PNG, JPEG, GIF, or WebP image.')

    await expect(
      updateTeamGeneral({
        userId: adminId,
        teamSlug,
        name: 'Team with oversized avatar',
        slug: teamSlug,
        avatarDataUrl: `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`,
      }),
    ).rejects.toThrow('Avatars must be 2 MB or smaller.')

    const avatarRows = await db
      .select({ avatarPath: teams.avatarPath })
      .from(teams)
      .where(eq(teams.id, teamId))

    expect(avatarRows).toEqual([{ avatarPath: null }])
  })
})

async function createTeamWithMembers({
  includeSecondOwner = true,
}: {
  includeSecondOwner?: boolean
} = {}) {
  const ownerId = makeId('user')
  const otherOwnerId = makeId('user')
  const adminId = makeId('user')
  const memberId = makeId('user')
  const teamId = makeId('team')
  const teamSlug = makeSlug(teamId)
  const userRows = [
    makeUser(ownerId),
    ...(includeSecondOwner ? [makeUser(otherOwnerId)] : []),
    makeUser(adminId),
    makeUser(memberId),
  ]
  touchedUserIds.push(...userRows.map((row) => row.id))
  touchedTeamIds.push(teamId)

  await db.insert(user).values(userRows)
  await db.insert(teams).values({
    id: teamId,
    name: 'Integration team',
    slug: teamSlug,
  })
  await db.insert(teamMembers).values([
    {
      id: makeId('member'),
      role: 'owner',
      teamId,
      userId: ownerId,
    },
    ...(includeSecondOwner
      ? [
          {
            id: makeId('member'),
            role: 'owner' as const,
            teamId,
            userId: otherOwnerId,
          },
        ]
      : []),
    {
      id: makeId('member'),
      role: 'admin',
      teamId,
      userId: adminId,
    },
    {
      id: makeId('member'),
      role: 'member',
      teamId,
      userId: memberId,
    },
  ])

  return {
    adminId,
    memberId,
    otherOwnerId: includeSecondOwner ? otherOwnerId : ownerId,
    ownerId,
    teamId,
    teamSlug,
  }
}

async function cleanupRows() {
  await Promise.all(
    touchedAvatarPaths.map((avatarPath) => removePublicFile(avatarPath)),
  )

  if (touchedInviteIds.length > 0) {
    await db
      .delete(teamInvites)
      .where(inArray(teamInvites.id, touchedInviteIds))
  }

  if (touchedTeamIds.length > 0) {
    await db
      .delete(teamMembers)
      .where(inArray(teamMembers.teamId, touchedTeamIds))
  }

  if (touchedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, touchedUserIds))
  }

  if (touchedTeamIds.length > 0) {
    await db
      .delete(teamInvites)
      .where(inArray(teamInvites.teamId, touchedTeamIds))
    await db.delete(teams).where(inArray(teams.id, touchedTeamIds))
  }

  touchedInviteIds.length = 0
  touchedAvatarPaths.length = 0
  touchedTeamIds.length = 0
  touchedUserIds.length = 0
}

async function inviteAndGetToken({
  email,
  ownerId,
  teamSlug,
}: {
  email: string
  ownerId: string
  teamSlug: string
}) {
  const result = await createTeamInvite({
    userId: ownerId,
    teamSlug,
    email,
    role: 'member',
  })
  touchedInviteIds.push(...result.invites.map((invite) => invite.id))

  return new URL(result.inviteUrl).pathname.split('/').pop() ?? ''
}

async function expectAvatarMissing(avatarPath: string) {
  const { access } = await import('node:fs/promises')
  const path = await import('node:path')

  await expect(
    access(path.join(process.cwd(), 'public', avatarPath)),
  ).rejects.toThrow()
}

function makeAvatarDataUrl() {
  return `data:image/png;base64,${Buffer.from('avatar').toString('base64')}`
}

function makeUser(
  id: string,
  email = `${id}@example.com`,
  emailVerified = true,
) {
  return {
    id,
    email,
    emailVerified,
    name: id,
    username: makeUsername(id),
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
