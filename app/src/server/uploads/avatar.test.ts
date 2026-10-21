import { beforeEach, expect, test, vi } from 'vitest'
import { removeOwnedAvatar, resolveAvatarUpdate } from './avatar'

const mocks = vi.hoisted(() => ({ put: vi.fn(), delete: vi.fn() }))
vi.mock('@/server/storage/object-store', () => ({
  getObjectStore: () => mocks,
}))
const owner = { filePrefix: 'user', resourceId: 'owner' } as const
const avatarDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`
beforeEach(() => {
  vi.resetAllMocks()
  mocks.put.mockResolvedValue(undefined)
  mocks.delete.mockResolvedValue(undefined)
})

test('uploads stage distinct versioned keys without overwriting or deleting the committed avatar', async () => {
  const input = {
    ...owner,
    avatarDataUrl,
    deleteAvatar: false,
    currentAvatarPath: '/uploads/avatars/user_owner.png',
  }
  const first = await resolveAvatarUpdate(input)
  const second = await resolveAvatarUpdate(input)
  expect(first).toMatch(/^\/uploads\/avatars\/user_owner~[a-f0-9]{32}\.png$/)
  expect(second).not.toBe(first)
  expect(mocks.put).toHaveBeenCalledTimes(2)
  expect(mocks.put).toHaveBeenNthCalledWith(
    1,
    first!.slice('/uploads/'.length),
    expect.any(Uint8Array),
    'image/png',
  )
  expect(mocks.delete).not.toHaveBeenCalled()
})

test('avatar removal stages a null value and leaves storage intact until the caller commits', async () => {
  expect(
    await resolveAvatarUpdate({
      ...owner,
      currentAvatarPath: '/uploads/avatars/user_owner.png',
      deleteAvatar: true,
    }),
  ).toBeNull()
  expect(mocks.delete).not.toHaveBeenCalled()
})

test.each([
  '/uploads/avatars/team_owner.png',
  '/uploads/avatars/user_victim.png',
  '/uploads/avatars/user_owner-other.png',
  '/uploads/avatars/user_owner.png?x',
  '/uploads/avatars/user_owner/../victim.png',
  '/uploads/avatars/user_owner~invalid.png',
  'https://example.com/avatar.png',
])('cleanup rejects an unowned or invalid object path: %s', async (path) => {
  await removeOwnedAvatar(path, owner)
  expect(mocks.delete).not.toHaveBeenCalled()
})

test.each([
  '/uploads/avatars/user_owner.png',
  `/uploads/avatars/user_owner~${'a'.repeat(32)}.webp`,
])(
  'cleanup accepts exactly this resource’s committed/staged key: %s',
  async (path) => {
    await removeOwnedAvatar(path, owner)
    expect(mocks.delete).toHaveBeenCalledWith(path.slice('/uploads/'.length))
  },
)
