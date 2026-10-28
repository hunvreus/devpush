// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { createDeferredModule } from './deferred-module'

test('a pending view shows its skeleton until its page module loads and reuses it afterward', async () => {
  let resolve!: (value: { label: string }) => void
  const importer = vi.fn(() => new Promise<{ label: string }>((done) => { resolve = done }))
  const deferred = createDeferredModule(importer)
  function Pending() {
    const module = deferred.useModule(true)
    return <div>{module?.label ?? 'Loading'}</div>
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  const root = createRoot(node)
  try {
    await act(async () => root.render(<Pending />))
    expect(node.textContent).toBe('Loading')
    expect(importer).toHaveBeenCalledOnce()
    await act(async () => { resolve({ label: 'Cached page' }); await deferred.load() })
    expect(node.textContent).toBe('Cached page')
    await deferred.load()
    expect(importer).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
