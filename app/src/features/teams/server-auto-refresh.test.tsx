// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { serverContextQueryOptions } from '#devpush/lib/server-context-query'
import { teamSectionQueryOptions } from '#devpush/lib/team-context-query'
import { setWorkspaceConnected } from '#devpush/lib/workspace-updates'
import { useWorkspaceUpdates } from './use-workspace-updates'

const source = vi.hoisted(() => ({ status: 'disconnected' }))
vi.mock('#devpush/server/servers/functions', () => ({
  getTeamServerContext: vi.fn(async () => ({
    server: { status: source.status },
  })),
}))
vi.mock('#devpush/server/teams/functions', () => ({
  getTeamSectionContext: vi.fn(async () => ({
    section: 'servers',
    servers: [{ status: source.status }],
  })),
  getTeamShellContext: vi.fn(),
}))
class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  onopen?: () => void
  onclose?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  send = vi.fn()
  close = vi.fn(() => this.onclose?.())
  constructor() {
    Socket.instances.push(this)
  }
}
function View() {
  useWorkspaceUpdates('test')
  const details = useQuery(
    serverContextQueryOptions({ teamSlug: 'test', serverId: 'server' }),
  )
  const list = useQuery(
    teamSectionQueryOptions({ teamSlug: 'test', section: 'servers' }),
  )
  return (
    <>
      <span data-testid="detail">{details.data?.server.status}</span>
      <span data-testid="list">{list.data?.servers?.[0]?.status}</span>
    </>
  )
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setWorkspaceConnected('test', false)
  Socket.instances = []
  source.status = 'disconnected'
})
test('server notifications refresh both list and details, and polling takes over after socket failure', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ available: true }) }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const node = document.createElement('div')
  const root = createRoot(node)
  const status = (id: string) =>
    node.querySelector(`[data-testid="${id}"]`)?.textContent
  const flush = async (ms = 10) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <View />
        </QueryClientProvider>,
      ),
    )
    await flush()
    expect(status('list')).toBe('disconnected')
    expect(status('detail')).toBe('disconnected')
    const socket = Socket.instances[0]
    expect(socket).toBeDefined()
    await act(async () => socket!.onopen?.())
    await flush()
    source.status = 'connected'
    await act(async () =>
      socket!.onmessage?.({
        data: JSON.stringify({ type: 'changed', kind: 'servers' }),
      }),
    )
    await flush(300)
    expect(status('list')).toBe('connected')
    expect(status('detail')).toBe('connected')
    await act(async () => socket!.close())
    await flush()
    source.status = 'disconnected'
    await flush(5100)
    expect(status('list')).toBe('disconnected')
    expect(status('detail')).toBe('disconnected')
  } finally {
    await act(async () => root.unmount())
    client.clear()
  }
})
