import { expect, test } from 'vitest'
import { onboardingDestination, shouldOfferPlan } from './onboarding'

test('preserves invitations and safe deep links while rejecting external destinations', () => {
  expect(onboardingDestination('/invites/secret?accept=1', 'acme')).toBe(
    '/invites/secret?accept=1',
  )
  expect(onboardingDestination('/acme/projects/shop', 'acme')).toBe(
    '/acme/projects/shop',
  )
  expect(onboardingDestination('//evil.example', 'acme')).toBe('/acme')
  expect(onboardingDestination('/onboarding/plans', 'acme')).toBe('/acme')
})
test('plan onboarding is limited to owners entering their own default workspace', () => {
  expect(shouldOfferPlan('/acme', 'acme', 'owner')).toBe(true)
  expect(shouldOfferPlan('/invites/token', 'acme', 'owner')).toBe(false)
  expect(shouldOfferPlan('/another-team', 'acme', 'owner')).toBe(false)
  expect(shouldOfferPlan('/acme', 'acme', 'member')).toBe(false)
})
