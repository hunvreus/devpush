/* Ambient modules require inline import types to keep this file a script. */
/* eslint-disable @typescript-eslint/consistent-type-imports */
// Keep this ambient file a script so cloudflare:workers is declared, not augmented.

type D1Database = import('@cloudflare/workers-types').D1Database

interface R2ObjectBody {
  arrayBuffer: () => Promise<ArrayBuffer>
  httpMetadata?: {
    contentType?: string
  }
}

interface R2Bucket {
  delete: (key: string) => Promise<void>
  get: (key: string) => Promise<R2ObjectBody | null>
  head: (key: string) => Promise<{ size: number } | null>
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>
}

interface WorkerVersionMetadata {
  id: string
  tag: string
}

interface WorkspaceUpdatesNamespace {
  getByName: (name: string) => {
    fetch: (request: Request) => Promise<Response>
    publish: (kind: string, activeSessionIds: string[]) => Promise<void>
  }
}

declare const WebSocketPair: typeof import('@cloudflare/workers-types').WebSocketPair
declare const WebSocketRequestResponsePair: typeof import('@cloudflare/workers-types').WebSocketRequestResponsePair
interface ResponseInit {
  webSocket?: import('@cloudflare/workers-types').WebSocket
}

interface Env {
  DEVPUSH_WORKSPACE_UPDATES?: WorkspaceUpdatesNamespace
  DEVPUSH_DATABASE: D1Database
  DEVPUSH_LOG_DATABASE: D1Database
  DEVPUSH_DATABASE_URL?: string
  DEVPUSH_LOG_DATABASE_URL?: string
  DEVPUSH_DATABASE_AUTH_TOKEN?: string
  DEVPUSH_LOG_DATABASE_AUTH_TOKEN?: string
  DEVPUSH_OBJECTS?: R2Bucket
}

interface ExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void
}

interface ScheduledController {
  scheduledTime: number
}

interface ExportedHandler<TEnvironment> {
  fetch?: (
    request: Request,
    env: TEnvironment,
    context: ExecutionContext,
  ) => Response | Promise<Response>
  scheduled?: (
    controller: ScheduledController,
    env: TEnvironment,
    context: ExecutionContext,
  ) => void | Promise<void>
}

declare module 'cloudflare:workers' {
  export const env: Env
  export const DurableObject: typeof import('@cloudflare/workers-types').DurableObject
}
