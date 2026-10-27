import { expect, test } from 'vitest'
import { onboardingDestination } from './onboarding'

test('preserves invitations and safe deep links while rejecting external destinations', () => {
  expect(onboardingDestination('/invites/secret?accept=1', 'acme')).toBe(
    '/invites/secret?accept=1',
  )
  expect(onboardingDestination('/acme/projects/shop', 'acme')).toBe(
    '/acme/projects/shop',
  )
  expect(onboardingDestination('//evil.example', 'acme')).toBe('/acme')
  expect(onboardingDestination('/onboarding/workspace', 'acme')).toBe('/acme')
})
