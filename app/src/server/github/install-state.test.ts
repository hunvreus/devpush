import { describe, expect, test } from 'vitest'

import {
  createGitHubInstallState,
  verifyGitHubInstallState,
} from './install-state'

describe('GitHub installation state', () => {
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
