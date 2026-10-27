import { getSafeRedirectPath } from './internal-redirect'

export function onboardingDestination(
  path: string | undefined,
  teamSlug: string,
) {
  const destination = getSafeRedirectPath(path ?? '/')
  return destination === '/' || destination.startsWith('/onboarding')
    ? `/${encodeURIComponent(teamSlug)}`
    : destination
}
