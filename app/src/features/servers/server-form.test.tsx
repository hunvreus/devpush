// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AddServerDialog } from './team-servers'
import type * as PluginUi from '#devpush/features/plugins/contributions'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  created: vi.fn(),
  upgrade: vi.fn(),
  setup: vi.fn(),
}))
vi.mock('#devpush/server/servers/functions', () => ({
  createServer: mocks.create,
}))
vi.mock('#devpush/features/plugins/contributions', async (importOriginal) => ({
  ...(await importOriginal<typeof PluginUi>()),
  requestWorkspaceAction: mocks.upgrade,
  useWorkspaceServerSetup: mocks.setup,
}))
beforeEach(() => mocks.setup.mockReturnValue({ fields: null, ready: true }))
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

test('a workspace policy refusal delegates remediation without creating a server', async () => {
  const view = await mount()
  await fill('host-4')
  mocks.upgrade.mockReturnValue(true)
  mocks.create.mockRejectedValueOnce({
    name: 'PublicError',
    code: 'WORKSPACE_RESTRICTED',
  })
  await submit()
  expect(mocks.upgrade).toHaveBeenCalledWith({
    teamSlug: 'team',
    error: { name: 'PublicError', code: 'WORKSPACE_RESTRICTED' },
  })
  expect(mocks.close).toHaveBeenCalledWith(false)
  expect(mocks.created).not.toHaveBeenCalled()
  await view.close()
})

test('creation waits until a plugin has loaded its server setup disclosure', async () => {
  mocks.setup.mockReturnValue({ fields: <p>Loading plan…</p>, ready: false })
  const view = await mount()
  await fill('host-1')
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent === 'Create server')!
  expect(button.disabled).toBe(true)
  await submit()
  expect(mocks.create).not.toHaveBeenCalled()
  mocks.setup.mockReturnValue({
    fields: <p>Additional servers cost $3/month.</p>,
    ready: true,
  })
  await fill('host-2')
  expect(button.disabled).toBe(false)
  expect(document.body.textContent).toContain(
    'Additional servers cost $3/month.',
  )
  await view.close()
})
