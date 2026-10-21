import { config } from '@/server/config'
import { PublicError } from '@/lib/public-error'

export function requireBackupsEnabled() {
  if (!config.DEVPUSH_BACKUPS_ENABLED) throw new PublicError('BACKUPS_DISABLED')
}
