import { toast } from 'sonner'

/** Keep the draft intact until the user explicitly chooses to reload. */
export function showSettingsConflict(error: unknown): boolean {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    error.code !== 'SETTINGS_CONFLICT'
  )
    return false
  toast.error('Your changes weren’t saved.', {
    id: 'settings-conflict',
    description:
      'Settings have changed since you started editing. Reload to load the latest settings.',
    duration: Infinity,
    closeButton: false,
    className: 'settings-conflict-toast',
    cancel: {
      label: 'Dismiss',
      onClick: () => toast.dismiss('settings-conflict'),
    },
    action: {
      label: 'Reload',
      onClick: () => {
        if (
          window.confirm('Reload and discard all unsaved changes on this page?')
        )
          if (
            'reloadUrl' in error &&
            typeof error.reloadUrl === 'string' &&
            error.reloadUrl.startsWith('/') &&
            !error.reloadUrl.startsWith('//') &&
            !error.reloadUrl.includes('\\') &&
            !error.reloadUrl.includes('\r') &&
            !error.reloadUrl.includes('\n')
          )
            window.location.assign(error.reloadUrl)
          else window.location.reload()
        else showSettingsConflict(error)
      },
    },
  })
  return true
}
