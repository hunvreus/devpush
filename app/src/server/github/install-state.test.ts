import { describe, expect, test } from 'vitest'
import { SignJWT } from 'jose'
import { config } from '#devpush/server/config'

import {
  createGitHubInstallState,
  verifyGitHubInstallState,
} from './install-state'

describe('GitHub installation state', () => {
  test.each(['devpush:email-verification', 'devpush:other-purpose'])(
    'rejects a token signed with the auth key for another audience: %s',
    async (audience) => {
      const state = await new SignJWT({ userId: 'user-1', next: '/team' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('devpush')
        .setAudience(audience)
        .setExpirationTime('15m')
        .sign(new TextEncoder().encode(config.BETTER_AUTH_SECRET))
      await expect(
        verifyGitHubInstallState({ state, userId: 'user-1' }),
      ).rejects.toThrow()
    },
  )
  test('round-trips the initiating user and a safe redirect', async () => {
    const state = await createGitHubInstallState({
      next: '/team/projects',
      userId: 'user-1',
    })

    await expect(
      verifyGitHubInstallState({ state, userId: 'user-1' }),
    ).resolves.toBe('/team/projects')
  })

  test('rejects use by a different user', async () => {
    const state = await createGitHubInstallState({
      next: '/team/projects',
      userId: 'user-1',
    })

    await expect(
      verifyGitHubInstallState({ state, userId: 'user-2' }),
    ).rejects.toThrow('Invalid GitHub installation state.')
  })

  test('normalizes external redirects to an internal path', async () => {
    const state = await createGitHubInstallState({
      next: 'https://attacker.example/steal',
      userId: 'user-1',
    })

    await expect(
      verifyGitHubInstallState({ state, userId: 'user-1' }),
    ).resolves.toBe('/')
  })
})
