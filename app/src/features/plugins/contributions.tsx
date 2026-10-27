import registered from '#devpush/plugins/registered-client'
import { pluginApiVersion } from '#devpush/plugins/version'
import type {
  ClientPlugin,
  ClientPluginEntry,
  WorkspacePluginProps,
} from '#devpush/plugins/client'

const plugins: readonly ClientPluginEntry[] = registered
const ids = new Set<string>()
for (const { id, implementation } of plugins) {
  if (ids.has(id)) throw new Error(`Duplicate client plugin: ${id}`)
  ids.add(id)
  if ((implementation.apiVersion as number) !== pluginApiVersion)
    throw new Error(`Incompatible client plugin: ${id}`)
}
function exclusive<TKey extends 'profile' | 'emailPreferences'>(
  key: TKey,
): ClientPlugin[TKey] {
  const matches = plugins.filter(({ implementation }) => implementation[key])
  if (matches.length > 1)
    throw new Error(
      `Conflicting ${key} contributions: ${matches.map(({ id }) => id).join(', ')}`,
    )
  return matches[0]?.implementation[key]
}
const useProfileFields =
  exclusive('profile')?.useFields ??
  (() => ({ fields: null, complete: async () => {} }))

export function useProfileContributions(input: { userId: string }) {
  return useProfileFields(input)
}
export function WorkspacePluginContributions({
  place,
  ...scope
}: WorkspacePluginProps & { place: 'header' | 'notice' }) {
  return plugins.map(({ id, implementation }) => {
    const Component = implementation.workspace?.[place]
    return Component ? <Component key={id} {...scope} /> : null
  })
}
const setupProviders = plugins.filter(
  ({ implementation }) => implementation.workspace?.useServerSetup,
)
if (setupProviders.length > 1)
  throw new Error('Conflicting server setup contributions.')
const useServerSetup =
  setupProviders[0]?.implementation.workspace?.useServerSetup ??
  (() => ({ fields: null, ready: true }))
export function useWorkspaceServerSetup(input: { teamSlug: string }) {
  return useServerSetup(input)
}
export const workspaceSettingsNavigation = plugins.flatMap(
  ({ implementation }) => implementation.workspace?.settings?.navigation ?? [],
)
export const accountSettingsNavigation = plugins.flatMap(
  ({ implementation }) => implementation.account?.navigation ?? [],
)
export function WorkspaceSettingsContributions(props: WorkspacePluginProps) {
  return plugins.map(({ id, implementation }) => {
    const Component = implementation.workspace?.settings?.Content
    return Component ? <Component key={id} {...props} /> : null
  })
}
export function WorkspaceSettingsPending() {
  return plugins.map(({ id, implementation }) => {
    const Component = implementation.workspace?.settings?.Pending
    return Component ? <Component key={id} /> : null
  })
}
export function AccountSettingsContributions(props: { userId: string }) {
  return plugins.map(({ id, implementation }) => {
    const Component = implementation.account?.Content
    return Component ? <Component key={id} {...props} /> : null
  })
}
export function AccountSettingsPending() {
  return plugins.map(({ id, implementation }) => {
    const Component = implementation.account?.Pending
    return Component ? <Component key={id} /> : null
  })
}
export function requestWorkspaceAction(input: {
  teamSlug: string
  error: unknown
}) {
  return plugins.some(
    ({ implementation }) =>
      implementation.workspace?.requestAction?.(input) ?? false,
  )
}
export function hasWorkspaceOnboarding() {
  return plugins.some(
    ({ implementation }) => implementation.workspace?.onboarding,
  )
}
export function WorkspaceOnboarding(
  props: WorkspacePluginProps & { onContinue: () => void },
) {
  return plugins.map(({ id, implementation }) => {
    const Component = implementation.workspace?.onboarding
    return Component ? <Component key={id} {...props} /> : null
  })
}

const useEmailPreferenceFields =
  exclusive('emailPreferences')?.useFields ??
  (() => ({
    fields: null,
    dirty: false,
    pending: false,
    save: async () => {},
    reset: () => {},
  }))
export function useEmailPreferenceContributions(input: { userId: string }) {
  return useEmailPreferenceFields(input)
}
