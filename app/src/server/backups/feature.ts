import { config } from '#devpush/server/config'
import { PublicError } from '#devpush/lib/public-error'

export function requireBackupsEnabled() {
  if (!config.DEVPUSH_BACKUPS_ENABLED) throw new PublicError('BACKUPS_DISABLED')
}
