// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { NewProjectPending } from './new-project-pending'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), error: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
  useParams: () => ({ teamSlug: 'team' }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
test('the loading dialog can be canceled while its data is still pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.navigate.mockResolvedValue(undefined)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  dispose = async () => {
    await act(async () => root.unmount())
    node.remove()
  }
  await act(async () => root.render(<NewProjectPending />))
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/$teamSlug',
    params: { teamSlug: 'team' },
  })
})
