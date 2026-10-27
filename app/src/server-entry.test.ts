import { expect, test, vi } from 'vitest'
import server from './server'

vi.mock('#devpush/server/realtime/service', () => ({
  connectWorkspaceUpdates: vi.fn(),
}))
vi.mock('#devpush/server/realtime/workspace-object', () => ({
  WorkspaceUpdates: class {},
}))
vi.mock('#devpush/server/config', () => ({
  assertRuntimeSecurity: vi.fn(),
  config: {},
}))
vi.mock('#devpush/server/db', () => ({
  withDatabaseScope: (callback: () => unknown) => callback(),
}))
vi.mock('#devpush/server/http/security-headers', () => ({
  withSecurityHeaders: (response: Response) => response,
}))
vi.mock('#devpush/server/http/proxy-request', () => ({
  resolveProxyRequest: (request: Request) => request,
}))
vi.mock('#devpush/server/scheduled-tasks', () => ({
  runScheduledTasks: vi.fn(),
}))
vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: async () => {
      const { deferBackgroundTask } =
        await import('./server/runtime/background')
      deferBackgroundTask(async () => {})
      return new Response('ok')
    },
  },
}))
test('Node development requests can defer work without a Cloudflare execution context', async () => {
  const response = await server.fetch(
    new Request('http://localhost/settings'),
    {} as Env,
    undefined,
  )
  expect(await response.text()).toBe('ok')
})
test('Worker requests register background work with their execution context', async () => {
  const waitUntil = vi.fn()
  await server.fetch(
    new Request('https://app.example/settings'),
    {} as Env,
    { waitUntil },
  )
  expect(waitUntil).toHaveBeenCalled()
})
