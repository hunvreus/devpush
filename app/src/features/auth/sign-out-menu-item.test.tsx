// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { SignOutMenuItem } from './sign-out-menu-item'

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/auth/client', () => ({ authClient: { signOut: mocks.signOut } }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, warning: mocks.warning },
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
  }: ComponentProps<'button'>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () => root.render(<SignOutMenuItem />))
  const button = node.querySelector('button')!
  return {
    button,
    close: async () => {
      await act(async () => root.unmount())
      node.remove()
    },
  }
}
test.each([false, true])(
  'failed sign out stays on page and allows retry (throws=%s)',
  async (throws) => {
    if (throws) mocks.signOut.mockRejectedValue(new Error('Failed to fetch'))
    else
      mocks.signOut.mockResolvedValue({
        error: { status: 500, message: 'HTTPError' },
      })
    const view = await mount()
    await act(async () => view.button.click())
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
    expect(view.button.disabled).toBe(false)
    await view.close()
  },
)
test('keeps sign out disabled until navigation completes', async () => {
  mocks.signOut.mockResolvedValue({})
  let finish!: () => void
  mocks.navigate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const view = await mount()
  await act(async () => view.button.click())
  expect(view.button.disabled).toBe(true)
  expect(view.button.textContent).toBe('Signing out…')
  await act(async () => finish())
  expect(mocks.error).not.toHaveBeenCalled()
  await view.close()
})
