export type ServerStatus =
  | 'pending'
  | 'connected'
  | 'disconnected'
  | 'disabled'
  | 'deleted'

export const serverDisconnectedAfterMs = 2 * 60 * 1000

export function getEffectiveServerStatus({
  status,
  lastSeenAt,
  now = new Date(),
}: {
  status: ServerStatus
  lastSeenAt: Date | null
  now?: Date
}): ServerStatus {
  if (status !== 'connected') {
    return status
  }

  if (!lastSeenAt) {
    return 'disconnected'
  }

  if (now.getTime() - lastSeenAt.getTime() > serverDisconnectedAfterMs) {
    return 'disconnected'
  }

  return 'connected'
}
