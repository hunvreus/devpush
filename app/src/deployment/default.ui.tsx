import type { ReactNode } from 'react'

export const workspaceSettingsNavigation: {
  href: `#${string}`
  label: string
}[] = []
export default function DeploymentWorkspaceSettings(_props: {
  teamSlug: string
  role: string
}) {
  return null
}

export function WorkspaceStatus(_props: { teamSlug: string; role: string }) {
  return null
}
export function WorkspaceNotice(_props: { teamSlug: string; role: string }) {
  return null
}
export function requestWorkspaceUpgrade(_input: {
  teamSlug: string
  reason: string
}) {
  return false
}

export function WorkspaceSettingsPending() {
  return null
}

export function WorkspaceServerSetupNotice(_props: { teamSlug: string }) {
  return null
}

export function hasPlanOnboarding(): boolean {
  return false
}
export function useProfileOnboarding(_props: { userId: string }): {
  fields: ReactNode
  complete: () => Promise<void>
} {
  return { fields: null, complete: async () => {} }
}
export function OnboardingPlans(_props: {
  teamSlug: string
  role: string
  onContinue: () => void
}) {
  return null
}

export const accountSettingsNavigation: {
  href: `#${string}`
  label: string
}[] = []
export function AccountEmailPreferences(_props: { userId: string }) {
  return null
}

export function AccountEmailPreferencesPending() {
  return null
}
