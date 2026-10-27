// @vitest-environment jsdom
import type { AdminOverview } from '#devpush/server/admin/service'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { AdminSettings } from './admin-settings'
import { TooltipProvider } from '#devpush/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  ban: vi.fn(),
  deleteUser: vi.fn(),
  deleteRule: vi.fn(),
  add: vi.fn(),
  importEmails: vi.fn(),
  refresh: vi.fn(),
  changeAllowlist: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock('#devpush/server/admin/functions', () => ({
  addAllowlistRuleAction: mocks.add,
  importAllowlistEmailsAction: mocks.importEmails,
  banUserAction: mocks.ban,
  deleteAdminUserAction: mocks.deleteUser,
  deleteAllowlistRuleAction: mocks.deleteRule,
  getInstallationReleaseStatus: vi.fn(),
  unbanUserAction: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.refresh }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
}))
vi.mock('#devpush/components/settings-layout', () => ({
  StandaloneSettingsLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: mocks.success },
}))
vi.mock('#devpush/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect: () => void
  }) => <button onClick={onSelect}>{children}</button>,
}))
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(overrides: Partial<AdminOverview> = {}) {
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
  await act(async () =>
    root.render(
      <TooltipProvider>
        <AdminSettings
          currentUserId="admin"
          onSearchChange={mocks.changeAllowlist}
          overview={{
            installation: { current: null, latest: null },
            users: [],
            allowlist: [],
            userPagination: {
              query: '',
              page: 1,
              pageCount: 1,
              total: overrides.users?.length ?? 0,
              pageSize: 25,
            },
            allowlistPagination: {
              query: '',
              page: 1,
              pageCount: 1,
              total: overrides.allowlist?.length ?? 0,
              pageSize: 25,
            },
            ...overrides,
          }}
        />
      </TooltipProvider>,
    ),
  )
  close = async () => {
    await act(async () => root.unmount())
    node.remove()
  }
}
async function click(text: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === text,
  )!
  await act(async () => button.click())
}
async function fill(id: string, value: string) {
  const input = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
test('invalid email rule stays inline without an API request', async () => {
  await mount()
  await click('Add rule')
  await fill('allowlist-value', 'not-an-email')
  await click('Add rule', document.querySelector('[role="dialog"]')!)
  expect(mocks.add).not.toHaveBeenCalled()
  expect(
    document.getElementById('allowlist-value-error')?.textContent,
  ).toContain('valid email')
  expect(mocks.error).not.toHaveBeenCalled()
})
test('mixed valid and invalid import is rejected before sending anything', async () => {
  await mount()
  await click('Bulk import')
  await fill('allowlist-import-emails', 'valid@example.com, invalid')
  await click('Import', document.querySelector('[role="dialog"]')!)
  expect(mocks.importEmails).not.toHaveBeenCalled()
  expect(
    document.getElementById('allowlist-import-error')?.textContent,
  ).toContain('invalid')
})

test('pending rule submission prevents duplicate submit, editing, and Escape dismissal', async () => {
  await mount()
  await click('Add rule')
  await fill('allowlist-value', 'user@example.com')
  let resolve!: (value: { fieldErrors: null }) => void
  mocks.add.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await click('Add rule', document.querySelector('[role="dialog"]')!)
  expect(document.getElementById('allowlist-value')?.matches(':disabled')).toBe(
    true,
  )
  await act(async () => {
    document
      .getElementById('allowlist-rule-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
  })
  expect(mocks.add).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => resolve({ fieldErrors: null }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.success).toHaveBeenCalledWith('Allowlist rule added.')
})
test('failed import preserves values and succeeds when retried', async () => {
  await mount()
  await click('Bulk import')
  await fill('allowlist-import-emails', 'user@example.com')
  mocks.importEmails.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await click('Import', document.querySelector('[role="dialog"]')!)
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
  ).toContain('Unable to connect')
  expect(
    (document.getElementById('allowlist-import-emails') as HTMLTextAreaElement)
      .value,
  ).toBe('user@example.com')
  mocks.importEmails.mockResolvedValueOnce({ fieldErrors: null })
  await click('Import', document.querySelector('[role="dialog"]')!)
  expect(mocks.importEmails).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
test('server validation errors stay beside the rule without closing the dialog', async () => {
  await mount()
  await click('Add rule')
  await fill('allowlist-value', 'user@example.com')
  mocks.add.mockResolvedValueOnce({
    fieldErrors: { value: 'This rule is invalid.' },
  })
  await click('Add rule', document.querySelector('[role="dialog"]')!)
  expect(document.getElementById('allowlist-value-error')?.textContent).toBe(
    'This rule is invalid.',
  )
  expect(mocks.success).not.toHaveBeenCalled()
})

test('admin confirmation stays open while pending and closes explicitly after success', async () => {
  await mount({
    users: [
      {
        id: 'target',
        name: 'Target',
        username: 'target',
        email: 'target@example.com',
        emailVerified: true,
        status: 'active',
        image: null,
        createdAt: new Date().toISOString(),
      },
    ],
  })
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Ban user"]')!
      .click(),
  )
  let resolve!: () => void
  mocks.ban.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await click('Ban user', document.querySelector('[role="alertdialog"]')!)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})

test.each([
  { trigger: 'Ban user', action: 'Ban user', mock: mocks.ban },
  { trigger: 'Remove user', action: 'Delete user', mock: mocks.deleteUser },
  {
    trigger: 'Remove allowlist rule',
    action: 'Delete rule',
    mock: mocks.deleteRule,
  },
])(
  '$action failures remain inside the confirmation and can be retried',
  async ({ trigger, action, mock }) => {
    await mount({
      users: [
        {
          id: 'target',
          name: 'Target',
          username: 'target',
          email: 'target@example.com',
          emailVerified: true,
          status: 'active',
          image: null,
          createdAt: new Date().toISOString(),
        },
      ],
      allowlist: [
        {
          id: 'rule',
          type: 'domain',
          value: 'example.com',
          createdAt: new Date().toISOString(),
        },
      ],
    })
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(`button[aria-label="${trigger}"]`)!
        .click(),
    )
    mock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await click(action, document.querySelector('[role="alertdialog"]')!)
    expect(
      document.querySelector('[role="alertdialog"] [role="alert"]')
        ?.textContent,
    ).toContain('Unable to connect')
    mock.mockResolvedValueOnce(undefined)
    await click(action, document.querySelector('[role="alertdialog"]')!)
    expect(mock).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  },
)

test('allowlist navigation keeps the applied search and search starts from page one', async () => {
  await mount({
    allowlistPagination: {
      query: 'example.com',
      page: 2,
      pageCount: 4,
      total: 80,
      pageSize: 25,
    },
  })
  const section = document.getElementById('allowlist')!
  const next = section.querySelector<HTMLButtonElement>(
    '[aria-label="Go to next page"]',
  )!
  await act(async () => next.click())
  expect(mocks.changeAllowlist).toHaveBeenCalledWith({
    allowlistQuery: 'example.com',
    allowlistPage: 3,
  })
  const input = section.querySelector<HTMLInputElement>(
    '[aria-label="Search allowlist"]',
  )!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'another.com')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Search', section)
  expect(mocks.changeAllowlist).toHaveBeenLastCalledWith({
    allowlistQuery: 'another.com',
    allowlistPage: 1,
  })
  expect(section.textContent).toContain('No matching allowlist rules.')
  expect(section.textContent).not.toContain('No allowlist entries.')
  expect(section.querySelector('table')).toBeNull()
  expect(section.querySelector('[data-slot=empty]')).not.toBeNull()
})

test('user search queries the server from page one and paging preserves the applied query', async () => {
  await mount({
    userPagination: {
      query: 'person',
      page: 2,
      pageCount: 3,
      total: 62,
      pageSize: 25,
    },
  })
  const section = document.getElementById('users')!
  await act(async () =>
    section
      .querySelector<HTMLButtonElement>('[aria-label="Go to next page"]')!
      .click(),
  )
  expect(mocks.changeAllowlist).toHaveBeenCalledWith({
    userQuery: 'person',
    userPage: 3,
  })
  await click('Search', section)
  expect(mocks.changeAllowlist).toHaveBeenLastCalledWith({
    userQuery: 'person',
    userPage: 1,
  })
})
