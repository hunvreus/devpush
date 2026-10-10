// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { useWorkspaceUpdates } from './use-workspace-updates'
import { workspacePollInterval } from '@/lib/workspace-updates'

const mocks = vi.hoisted(() => ({ invalidate: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
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
  return null
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  Socket.instances = []
})
test('socket disconnect restores polling, reconnects, and unmount stops reconnection', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ available: true }) }),
  )
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<View />))
  expect(Socket.instances).toHaveLength(1)
  Socket.instances[0]!.onopen?.()
  expect(workspacePollInterval('test', 2000)).toBe(60000)
  Socket.instances[0]!.onmessage?.({
    data: JSON.stringify({ type: 'changed', kind: 'deployments' }),
  })
  await vi.advanceTimersByTimeAsync(250)
  expect(mocks.invalidate).toHaveBeenCalledTimes(2)
  Socket.instances[0]!.close()
  expect(workspacePollInterval('test', 2000)).toBe(2000)
  await vi.advanceTimersByTimeAsync(1600)
  expect(Socket.instances).toHaveLength(2)
  await act(async () => root.unmount())
  await vi.advanceTimersByTimeAsync(60000)
  expect(Socket.instances).toHaveLength(2)
})
