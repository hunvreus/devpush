import { DurableObject } from 'cloudflare:workers'
import type {
  DurableObjectState,
  WebSocket as CloudflareSocket,
} from '@cloudflare/workers-types'

export class WorkspaceUpdates extends DurableObject<Env> {
  private readonly state: DurableObjectState

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.state = ctx
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    )
  }

  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('WebSocket required', { status: 426 })
    const sessionId = request.headers.get('x-devpush-session')
    const expiresAt = Number(request.headers.get('x-devpush-session-expires'))
    if (!sessionId || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
      return new Response('Unauthorized', { status: 401 })
    if (this.state.getWebSockets().length >= 2000)
      return new Response('Workspace connection limit reached', { status: 503 })
    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ sessionId, expiresAt })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  publish(kind: string, activeSessionIds: string[]) {
    const authorized = new Set(activeSessionIds)
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as {
        sessionId: string
        expiresAt: number
      } | null
      if (
        !attachment ||
        attachment.expiresAt <= Date.now() ||
        !authorized.has(attachment.sessionId)
      ) {
        socket.close(1008, 'Authorization expired')
        continue
      }
      try {
        socket.send(JSON.stringify({ type: 'changed', kind }))
      } catch {
        socket.close(1011, 'Reconnect required')
      }
    }
  }

  webSocketMessage(socket: CloudflareSocket) {
    socket.close(1008, 'Notifications only')
  }
  webSocketClose(socket: CloudflareSocket, code: number, reason: string) {
    socket.close(code, reason)
  }
}
