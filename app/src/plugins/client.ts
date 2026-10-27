import type { ComponentType, ReactNode } from 'react'
import { pluginApiVersion } from './version'

export interface WorkspacePluginProps {
  teamSlug: string
  role: string
}
export interface SettingsContribution<TProps> {
  navigation: readonly { href: `#${string}`; label: string }[]
  Content: ComponentType<TProps>
  Pending: ComponentType
}
export interface ProfileContribution {
  fields: ReactNode
  complete: () => Promise<void>
}
export interface EmailPreferenceContribution {
  fields: ReactNode
  dirty: boolean
  pending: boolean
  save: () => Promise<void>
  reset: () => void
}
export interface ClientPlugin {
  emailPreferences?: {
    useFields: (input: { userId: string }) => EmailPreferenceContribution
  }

  apiVersion: typeof pluginApiVersion
  workspace?: {
    header?: ComponentType<WorkspacePluginProps>
    notice?: ComponentType<WorkspacePluginProps>
    useServerSetup?: (input: { teamSlug: string }) => {
      fields: ReactNode
      ready: boolean
    }
    settings?: SettingsContribution<WorkspacePluginProps>
    onboarding?: ComponentType<
      WorkspacePluginProps & { onContinue: () => void }
    >
    requestAction?: (input: { teamSlug: string; error: unknown }) => boolean
  }
  account?: SettingsContribution<{ userId: string }>
  profile?: {
    useFields: (input: { userId: string }) => ProfileContribution
  }
}
export interface ClientPluginEntry {
  id: string
  implementation: ClientPlugin
}

export function defineClientPlugin(
  plugin: Omit<ClientPlugin, 'apiVersion'>,
): Readonly<ClientPlugin> {
  return Object.freeze({ ...plugin, apiVersion: pluginApiVersion })
}
