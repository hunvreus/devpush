import { beforeAll, afterAll, expect, test, vi } from 'vitest'
import { closeDb, db } from '#devpush/server/db'
import { teams, teamMembers, user } from '#devpush/server/db/schema'
import { pluginContext } from './server-context'
import type * as EmailService from '#devpush/server/email/service'
import type * as ServerConfig from '#devpush/server/config'

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('#devpush/server/email/service', async (importOriginal) => ({
  ...(await importOriginal<typeof EmailService>()),
  sendEmail,
}))
vi.mock('#devpush/server/config', async (importOriginal) => {
  const original = await importOriginal<typeof ServerConfig>()
  return {
    ...original,
    config: { ...original.config, EMAIL_FROM: 'devpush <sender@example.test>' },
  }
})
afterAll(closeDb)

beforeAll(async () => {
  await db
    .insert(teams)
    .values({ id: 'notice-team', name: 'Notices', slug: 'notice-team' })
  for (const [id, role, status] of [
    ['notice-owner', 'owner', 'active'],
    ['notice-member', 'member', 'active'],
    ['notice-inactive', 'owner', 'deleted'],
  ] as const) {
    await db.insert(user).values({
      id,
      name: id,
      username: id,
      email: `${id}@example.test`,
      emailVerified: true,
      status,
    })
    await db
      .insert(teamMembers)
      .values({ id, teamId: 'notice-team', userId: id, role })
  }
})

test('workspace plugin reads expose the regular avatar identity', async () => {
  const { getResourceColor } = await import('#devpush/server/resources/color')
  const { eq } = await import('drizzle-orm')
  await db
    .update(teams)
    .set({ avatarPath: '/avatars/workspace.png' })
    .where(eq(teams.id, 'notice-team'))
  const workspace = await pluginContext.readWorkspace!('notice-team')
  expect(workspace?.image).toBe('/avatars/workspace.png')
  expect(workspace?.color).toBe(getResourceColor('notice-team'))
})

test('generic transactional delivery bypasses operational preferences and personal mutes', async () => {
  const { saveNotificationPreferences, saveNotificationMute } =
    await import('#devpush/server/notifications/preferences')
  await saveNotificationPreferences(
    'notice-owner',
    { deployments: false, backups: false, domains: false, servers: false },
    0,
  )
  await saveNotificationMute(
    'notice-owner',
    { kind: 'workspace', id: 'notice-team' },
    true,
  )
  sendEmail.mockReset().mockResolvedValue(undefined)
  await pluginContext.notifyUser!({
    userId: 'notice-owner',
    subject: 'Required account notice',
    message: 'Action needed.',
    idempotencyKey: 'required-owner',
  })
  expect(sendEmail).toHaveBeenCalledTimes(1)
  expect(sendEmail.mock.calls[0]![0].to).toBe('notice-owner@example.test')
  expect(sendEmail.mock.calls[0]![1]).toBe('required-owner')
})

test('owner enumeration excludes inactive accounts and ordinary members', async () => {
  expect(await pluginContext.listWorkspaceOwners!('notice-team')).toEqual([
    'notice-owner',
  ])
})

test('persisted transactional rendering stays stable and never targets an obsolete mailbox', async () => {
  const { eq } = await import('drizzle-orm')
  const input = {
    userId: 'notice-owner',
    subject: 'Stable notice',
    message: 'Original content',
    idempotencyKey: 'stable-notice',
  }
  const prepared = await pluginContext.prepareNotification!(input)
  expect(prepared).not.toBeNull()
  sendEmail.mockReset().mockResolvedValue(undefined)
  await pluginContext.notifyUser!({
    ...input,
    message: 'Changed content',
    prepared: prepared!,
  })
  await pluginContext.notifyUser!({ ...input, prepared: prepared! })
  expect(sendEmail.mock.calls[0]).toEqual(sendEmail.mock.calls[1])
  expect(sendEmail.mock.calls[0]![0]).toEqual(prepared)
  await db
    .update(user)
    .set({ email: 'changed@example.test' })
    .where(eq(user.id, input.userId))
  expect(
    await pluginContext.notifyUser!({ ...input, prepared: prepared! }),
  ).toBe(false)
  expect(sendEmail).toHaveBeenCalledTimes(2)
  await db
    .update(user)
    .set({ email: 'notice-owner@example.test' })
    .where(eq(user.id, input.userId))
})
