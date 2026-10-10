import { defineWebSocketHandler } from 'nitro'
import { authorizeWorkspaceUpdates, connectWorkspaceUpdates } from './service'
import { nodeBroadcaster } from './node-broadcaster'
import type { WorkspaceConnection } from './node-broadcaster'

function connection(
  context: Record<string, unknown>,
): WorkspaceConnection | null {
  return typeof context.teamId === 'string' &&
    typeof context.sessionId === 'string' &&
    typeof context.expiresAt === 'number'
    ? {
        teamId: context.teamId,
        sessionId: context.sessionId,
        expiresAt: context.expiresAt,
      }
    : null
}

export default defineWebSocketHandler(
  {
    async upgrade(request) {
      const authorization = await authorizeWorkspaceUpdates(request)
      if (authorization instanceof Response) return authorization
      return { context: authorization }
    },
    open(peer) {
      const auth = connection(peer.context)
      if (!auth) {
        peer.close(1008, 'Unauthorized')
        return
      }
      nodeBroadcaster.add(peer, auth)
    },
    message(peer, message) {
      const auth = connection(peer.context)
      if (!auth || auth.expiresAt <= Date.now()) {
        peer.close(1008, 'Authorization expired')
        return
      }
      if (message.text() === 'ping') peer.send('pong')
      else peer.close(1008, 'Notifications only')
    },
    close(peer) {
      const auth = connection(peer.context)
      if (auth) nodeBroadcaster.remove(peer, auth.teamId)
    },
    error(peer) {
      const auth = connection(peer.context)
      if (auth) nodeBroadcaster.remove(peer, auth.teamId)
      peer.close(1011, 'Reconnect required')
    },
  },
  (event) => connectWorkspaceUpdates(event.req),
)
