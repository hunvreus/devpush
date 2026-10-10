export type WorkspaceConnection = {
  teamId: string
  sessionId: string
  expiresAt: number
}
export type NotificationPeer = {
  id: string
  send: (message: string) => unknown
  close: (code: number, reason: string) => unknown
}

export function createNodeBroadcaster() {
  const workspaces = new Map<
    string,
    Map<string, { peer: NotificationPeer; auth: WorkspaceConnection }>
  >()
  function remove(peer: NotificationPeer, teamId: string) {
    const connections = workspaces.get(teamId)
    connections?.delete(peer.id)
    if (!connections?.size) workspaces.delete(teamId)
  }
  return {
    add(peer: NotificationPeer, auth: WorkspaceConnection) {
      let connections = workspaces.get(auth.teamId)
      if (!connections) {
        connections = new Map()
        workspaces.set(auth.teamId, connections)
      }
      if (connections.size >= 2000) {
        peer.close(1013, 'Workspace connection limit reached')
        return
      }
      connections.set(peer.id, { peer, auth })
    },
    remove,
    getByName(teamId: string) {
      return {
        async fetch() {
          return new Response('Use the Node upgrade handler', { status: 426 })
        },
        async publish(kind: string, activeSessionIds: string[]) {
          const authorized = new Set(activeSessionIds)
          for (const { peer, auth } of workspaces.get(teamId)?.values() ?? []) {
            if (
              auth.expiresAt <= Date.now() ||
              !authorized.has(auth.sessionId)
            ) {
              remove(peer, teamId)
              peer.close(1008, 'Authorization expired')
              continue
            }
            try {
              peer.send(JSON.stringify({ type: 'changed', kind }))
            } catch {
              remove(peer, teamId)
              peer.close(1011, 'Reconnect required')
            }
          }
        },
      }
    },
  }
}

// Nitro may load this module in separate HTTP/SSR bundles. Share the registry
// across those module copies and development reloads within one process.
const runtime = globalThis as typeof globalThis & {
  __devpushWorkspaceBroadcaster?: ReturnType<typeof createNodeBroadcaster>
}
export const nodeBroadcaster = (runtime.__devpushWorkspaceBroadcaster ??=
  createNodeBroadcaster())
