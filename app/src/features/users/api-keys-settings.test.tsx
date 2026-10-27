// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiKeysSettings } from './api-keys-settings'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }))
vi.mock('#devpush/server/api/functions', () => ({
  getApiKeyTeamsAction: async () => ({
    items: settings.teams,
    pagination: settings.pagination,
  }),
  getApiKeyProjectsAction: async () => ({
    items: [],
    pagination: settings.pagination,
  }),
  getApiKeySettingsAction: mocks.list,
  createApiKeyAction: mocks.create,
  rotateApiKeyAction: mocks.rotate,
  revokeApiKeyAction: mocks.revoke,
}))
vi.mock('#devpush/lib/action-feedback', () => ({
  mutationErrorOptions: () => [],
  afterMutation: async (task: () => Promise<unknown>) => task(),
}))
const key = {
  id: 'k',
  name: 'CI deploy',
  prefix: 'dp_abc',
  teamId: 't',
  teamName: 'Team',
  projectIds: null,
  preset: 'deploy',
  scopes: [],
  status: 'active',
  createdAt: '2026-10-13T00:00:00Z',
  expiresAt: '2026-11-13T00:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
}
const settings = {
  pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
  keys: [key],
  teams: [{ id: 't', name: 'Team', slug: 'team', role: 'owner', projects: [] }],
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  cleanup.push(async () => {
    await act(async () => root.unmount())
    client.clear()
    node.remove()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ApiKeysSettings userId="u" />
      </QueryClientProvider>,
    ),
  )
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('CI deploy'),
  )
}
async function click(label: string) {
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === label)!
      .click(),
  )
}
async function openActions() {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="Actions for API key CI deploy"]',
  )!
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  )
}
async function nameKey() {
  const input = document.getElementById('api-key-name') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Example')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submitKey() {
  await act(async () =>
    document
      .querySelector<HTMLFormElement>('#create-api-key')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}

async function chooseExpiration(label: string) {
  const previousScroll = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView',
  )
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  cleanup.push(async () => {
    if (previousScroll) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', previousScroll)
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="API key expiration"]',
  )!
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  )
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === label)!
      .click(),
  )
}

test('key values are shown once after creation and cleared on dialog close', async () => {
  mocks.list.mockResolvedValue(settings)
  mocks.create.mockResolvedValue({ key, secret: 'dp_test_once_only' })
  await mount()
  await click('Create API key')
  await nameKey()
  await submitKey()
  expect(mocks.create).toHaveBeenCalledWith({
    data: {
      name: 'Example',
      teamId: 't',
      projectIds: null,
      preset: 'read',
      includeLogs: false,
      expiresInDays: 30,
    },
  })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'dp_test_once_only',
  )
  await click('Done')
  expect(document.body.textContent).not.toContain('dp_test_once_only')
})

test.each([
  { label: 'Never expires', days: null },
  { label: '1 year', days: 365 },
])('creation submits the $label expiration choice', async ({ label, days }) => {
  mocks.list.mockResolvedValue(settings)
  mocks.create.mockResolvedValue({ key, secret: 'dp_test_expiration' })
  await mount()
  await click('Create API key')
  await nameKey()
  await chooseExpiration(label)
  await submitKey()
  expect(mocks.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ expiresInDays: days }),
  })
})

test('history labels non-expiring keys without displaying a date', async () => {
  mocks.list.mockResolvedValue({
    ...settings,
    keys: [{ ...key, expiresAt: null }],
  })
  await mount()
  const row = document.querySelector('li')!
  expect(row.textContent).toContain('Never expires')
  expect(row.textContent).not.toContain('Expires ')
  expect(row.textContent).not.toContain('1970')
})

test('revoke requires confirmation and retains the dialog on a failed request', async () => {
  mocks.list.mockResolvedValue(settings)
  mocks.revoke.mockRejectedValueOnce(new Error('private diagnostics'))
  await mount()
  await openActions()
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Revoke')!
      .click(),
  )
  expect(mocks.revoke).not.toHaveBeenCalled()
  await click('Revoke')
  expect(mocks.revoke).toHaveBeenCalledWith({ data: { id: 'k' } })
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to update API key.'),
  )
  expect(document.body.textContent).not.toContain('private diagnostics')
})
