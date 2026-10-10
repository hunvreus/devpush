// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { useRefreshError } from './use-refresh-error'

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
function Probe({ error }: { error: unknown }) {
  useRefreshError(error, 'deployments-refresh')
  return <div>Existing deployments</div>
}

test('background failures keep content visible and clear feedback on recovery', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  const root = createRoot(node)
  try {
    await act(async () =>
      root.render(<Probe error={new Error('SQL details')} />),
    )
    expect(node.textContent).toBe('Existing deployments')
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('out of date'),
      { id: 'deployments-refresh' },
    )
    expect(toast.error.mock.calls[0]?.[0]).not.toContain('SQL')
    await act(async () => root.render(<Probe error={null} />))
    expect(toast.dismiss).toHaveBeenCalledWith('deployments-refresh')
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
