// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { AddServerDialog } from './team-servers'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  created: vi.fn(),
}))
vi.mock('@/server/servers/functions', () => ({ createServer: mocks.create }))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () =>
    root.render(
      <AddServerDialog
        open
        teamSlug="team"
        onOpenChange={mocks.close}
        onCreated={mocks.created}
      />,
    ),
  )
  return {
    close: async () => {
      await act(async () => root.unmount())
      node.remove()
    },
  }
}
async function fill(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('#server-name')!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => {
    document
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
test('invalid server names are rejected inline before enrollment is created', async () => {
  const view = await mount()
  await fill(' invalid host ')
  await submit()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(
    document.querySelector('#new-server-name-error')?.textContent,
  ).toContain('Use letters')
  await view.close()
})
test('failed creation keeps the entered name and allows retry', async () => {
  const view = await mount()
  await fill('host-1')
  mocks.create.mockRejectedValueOnce(new Error('HTTPError'))
  await submit()
  expect(document.querySelector('#new-server-name-error')?.textContent).toBe(
    'Unable to add server.',
  )
  expect(document.querySelector<HTMLInputElement>('#server-name')?.value).toBe(
    'host-1',
  )
  expect(mocks.close).not.toHaveBeenCalled()
  expect(mocks.created).not.toHaveBeenCalled()
  await view.close()
})
test('pending creation prevents editing and dismissal until the request settles', async () => {
  const view = await mount()
  await fill('host-1')
  let fail!: (error: unknown) => void
  mocks.create.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject
    }),
  )
  await submit()
  expect(
    document.querySelector<HTMLInputElement>('#server-name')?.disabled,
  ).toBe(true)
  const cancel = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === 'Cancel',
  )
  await act(async () => cancel?.click())
  expect(mocks.close).not.toHaveBeenCalled()
  await act(async () => fail(new Error('offline')))
  expect(
    document.querySelector<HTMLInputElement>('#server-name')?.disabled,
  ).toBe(false)
  await view.close()
})
