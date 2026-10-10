// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { TeamInvite } from './team-invite'

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  navigate: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/server/teams/functions', () => ({
  acceptTeamInviteAction: mocks.accept,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () => root.render(<TeamInvite token="token" />))
  return {
    node,
    click: async () =>
      act(async () =>
        node.querySelector<HTMLButtonElement>('[data-accept-invite]')?.click(),
      ),
    close: async () => {
      await act(async () => root.unmount())
      node.remove()
    },
  }
}
test('invitation errors do not expose technical details', async () => {
  mocks.accept.mockRejectedValue(new Error('HTTPError'))
  const view = await mount()
  await view.click()
  expect(view.node.textContent).toContain(
    'The invitation could not be accepted.',
  )
  expect(view.node.textContent).not.toContain('HTTPError')
  expect(mocks.navigate).not.toHaveBeenCalled()
  await view.close()
})
test('failed navigation does not report that accepting the invitation failed', async () => {
  mocks.accept.mockResolvedValue('team')
  mocks.navigate.mockRejectedValue(new Error('offline'))
  const view = await mount()
  await view.click()
  expect(view.node.textContent).not.toContain(
    'The invitation could not be accepted.',
  )
  await view.click()
  expect(mocks.accept).toHaveBeenCalledTimes(1)
  expect(mocks.warning).toHaveBeenCalledWith(
    'Invitation accepted, but opening the team failed. Please reload.',
  )
  await view.close()
})

test('pending acceptance blocks cancellation and duplicate submissions, then permits retry on failure', async () => {
  let reject!: (error: Error) => void
  mocks.accept.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const view = await mount()
  await view.click()
  expect(view.node.querySelector('a')).toBeNull()
  const buttons = [...view.node.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons.every((button) => button.disabled)).toBe(true)
  await view.click()
  expect(mocks.accept).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(view.node.querySelector('[role="alert"]')?.textContent).toContain(
    'could not be accepted',
  )
  mocks.accept.mockResolvedValueOnce('team')
  await view.click()
  expect(mocks.accept).toHaveBeenCalledTimes(2)
  expect(mocks.navigate).toHaveBeenCalled()
  await view.close()
})

vi.mock('@/lib/resource-cache', () => ({
  invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
