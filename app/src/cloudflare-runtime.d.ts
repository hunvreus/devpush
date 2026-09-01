interface Hyperdrive {
  connectionString: string
}

interface R2ObjectBody {
  arrayBuffer: () => Promise<ArrayBuffer>
  httpMetadata?: {
    contentType?: string
  }
}

interface R2Bucket {
  delete: (key: string) => Promise<void>
  get: (key: string) => Promise<R2ObjectBody | null>
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

interface Env {
  DEVPUSH_DATABASE: Hyperdrive
  DEVPUSH_OBJECTS: R2Bucket
}

interface ExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void
}

interface ScheduledController {
  scheduledTime: number
}

interface ExportedHandler<TEnvironment> {
  fetch?: (request: Request, env: TEnvironment) => Response | Promise<Response>
  scheduled?: (
    controller: ScheduledController,
    env: TEnvironment,
    context: ExecutionContext,
  ) => void | Promise<void>
}

declare module 'cloudflare:workers' {
  export const env: Env
}
