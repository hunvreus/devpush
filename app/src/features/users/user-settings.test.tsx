// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { UserSettings } from './user-settings'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('./connected-apps-settings', () => ({
  ConnectedAppsSettings: () => null,
}))
vi.mock('./api-keys-settings', () => ({ ApiKeysSettings: () => null }))

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  email: vi.fn(),
  leave: vi.fn(),
  deleteAccount: vi.fn(),
  disconnect: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  clearCache: vi.fn(),
}))
vi.mock('@/server/users/functions', () => ({
  updateUserGeneralAction: mocks.save,
  requestEmailChangeAction: mocks.email,
  deleteUserAccountAction: mocks.deleteAccount,
  disconnectAuthAccountAction: mocks.disconnect,
  leaveTeamAction: mocks.leave,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, navigate: mocks.navigate }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/settings-layout', () => ({
  StandaloneSettingsLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}))
vi.mock('@/lib/auth/client', () => ({
  authClient: { signOut: mocks.signOut, linkSocial: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: mocks.success },
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const context: ComponentProps<typeof UserSettings>['context'] = {
  user: {
    settingsVersion: 1,
    id: 'u',
    name: '',
    username: 'hunvreus',
    email: 'test@example.com',
    image: null,
    defaultTeamId: 't',
    isInstallationAdmin: false,
  },
  defaultTeam: {
    settingsVersion: 1,
    id: 't',
    name: 'Team',
    slug: 'team',
    image: null,
    color: 'lime',
    role: 'owner',
  },
  accounts: [],
  teams: [],
  invites: [],
  authMethods: { email: true, github: false, google: false },
}
async function mount(
  overrides: Partial<ComponentProps<typeof UserSettings>['context']> = {},
) {
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
        <UserSettings context={{ ...context, ...overrides }} />
      </TooltipProvider>,
    ),
  )
  return {
    node,
    render: async (next: typeof context) => {
      root.render(
        <TooltipProvider>
          <UserSettings context={next} />
        </TooltipProvider>,
      )
    },
    close: async () => {
      await act(async () => root.unmount())
      node.remove()
    },
  }
}
async function fill(node: HTMLElement, id: string, value: string) {
  const input = node.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function save(node: HTMLElement) {
  const button = [
    ...node.querySelectorAll<HTMLButtonElement>('#general button'),
  ].find((item) => item.textContent === 'Save')!
  await act(async () => button.click())
}
test('empty name blocks saving and shows a focused inline required error, not a toast', async () => {
  const view = await mount()
  await fill(view.node, 'account-username', 'another')
  await save(view.node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(view.node.querySelector('#account-name-error')?.textContent).toBe(
    'Enter your name.',
  )
  expect(
    view.node.querySelector<HTMLInputElement>('#account-name')?.required,
  ).toBe(true)
  expect(document.activeElement?.id).toBe('account-name')
  expect(mocks.error).not.toHaveBeenCalled()
  await view.close()
})
test('server avatar errors appear beneath the upload control and preserve the form', async () => {
  const view = await mount()
  await fill(view.node, 'account-name', 'Ronan')
  mocks.save.mockResolvedValueOnce({
    fieldErrors: {
      avatarDataUrl: 'The uploaded file does not match its image type.',
    },
  })
  await save(view.node)
  expect(
    view.node.querySelector('#account-avatar-error')?.textContent,
  ).toContain('does not match')
  expect(
    view.node.querySelector<HTMLInputElement>('#account-name')?.value,
  ).toBe('Ronan')
  expect(mocks.error).not.toHaveBeenCalled()
  expect(mocks.success).not.toHaveBeenCalled()
  await view.close()
})
test('correcting the name clears the inline error and allows saving', async () => {
  const view = await mount()
  await fill(view.node, 'account-username', 'another')
  await save(view.node)
  await fill(view.node, 'account-name', 'Ronan')
  mocks.save.mockResolvedValueOnce({
    user: {
      ...context.user,
      settingsVersion: 2,
      name: 'Ronan',
      username: 'another',
    },
    fieldErrors: null,
  })
  await save(view.node)
  expect(mocks.save).toHaveBeenCalledWith({
    data: {
      settingsVersion: 1,
      name: 'Ronan',
      username: 'another',
      avatarDataUrl: null,
      deleteAvatar: false,
    },
  })
  expect(view.node.querySelector('#account-name-error')).toBeNull()
  await view.close()
})

test('cancel ignores an image that finishes reading afterward', async () => {
  const readers: FileReader[] = []
  const read = vi
    .spyOn(FileReader.prototype, 'readAsDataURL')
    .mockImplementation(function (this: FileReader) {
      readers.push(this)
    })
  const view = await mount()
  await fill(view.node, 'account-username', 'another')
  const input = view.node.querySelector<HTMLInputElement>('input[type="file"]')!
  await act(async () => {
    Object.defineProperty(input, 'files', {
      value: [new File(['image'], 'avatar.png', { type: 'image/png' })],
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const pendingSave = [
    ...view.node.querySelectorAll<HTMLButtonElement>('#general button'),
  ].find((button) => button.textContent === 'Save')!
  expect(pendingSave.disabled).toBe(true)
  expect(view.node.querySelector('[role="status"]')?.textContent).toBe(
    'Reading image…',
  )
  await act(async () => {
    view.node
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(mocks.save).not.toHaveBeenCalled()
  await act(async () => {
    const cancel = [
      ...view.node.querySelectorAll<HTMLButtonElement>('#general button'),
    ].find((button) => button.textContent === 'Cancel')!
    cancel.click()
  })
  await act(async () => {
    Object.defineProperty(readers[0]!, 'result', {
      value: 'data:image/png;base64,aW1hZ2U=',
    })
    readers[0]!.dispatchEvent(new ProgressEvent('load'))
  })
  const saveButton = [
    ...view.node.querySelectorAll<HTMLButtonElement>('#general button'),
  ].find((button) => button.textContent === 'Save')!
  expect(saveButton.disabled).toBe(true)
  await view.close()
  read.mockRestore()
})

async function submitEmail(node: HTMLElement) {
  await act(async () =>
    node
      .querySelector('#account-email-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}
test('email changes validate inline and retain the address after delivery failure', async () => {
  const view = await mount()
  await fill(view.node, 'account-email', 'invalid')
  await submitEmail(view.node)
  expect(mocks.email).not.toHaveBeenCalled()
  expect(
    view.node.querySelector('#account-email-error')?.textContent,
  ).toContain('valid email')
  await fill(view.node, 'account-email', 'new@example.com')
  mocks.email.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await submitEmail(view.node)
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  expect(
    view.node.querySelector<HTMLInputElement>('#account-email')?.value,
  ).toBe('new@example.com')
  expect(mocks.success).not.toHaveBeenCalled()
  await view.close()
})
test('pending email changes disable edits and duplicate submission, then reset after success', async () => {
  const view = await mount()
  await fill(view.node, 'account-email', 'NEW@example.com')
  let resolve!: () => void
  mocks.email.mockReturnValueOnce(
    new Promise<{ settingsVersion: number }>((done) => {
      resolve = () => done({ settingsVersion: 2 })
    }),
  )
  await submitEmail(view.node)
  await submitEmail(view.node)
  expect(mocks.email).toHaveBeenCalledTimes(1)
  expect(mocks.email).toHaveBeenCalledWith({
    data: { newEmail: 'new@example.com', settingsVersion: 1 },
  })
  expect(
    view.node.querySelector<HTMLInputElement>('#account-email')?.disabled,
  ).toBe(true)
  await act(async () => resolve())
  expect(
    view.node.querySelector<HTMLInputElement>('#account-email')?.value,
  ).toBe('test@example.com')
  expect(mocks.success).toHaveBeenCalledWith('Verification email sent.')
  await view.close()
})

async function dialogButton(label: string) {
  await act(async () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ]
      .find((item) => item.textContent === label)!
      .click(),
  )
}
test('leaving a team keeps failures in the dialog and prevents dismissal during retry', async () => {
  const view = await mount({
    teams: [
      { ...context.defaultTeam, id: 'other', name: 'Other', isDefault: false },
    ],
  })
  await act(async () =>
    view.node
      .querySelector<HTMLButtonElement>('[aria-label="Leave Other"]')!
      .click(),
  )
  mocks.leave.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await dialogButton('Leave team')
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: () => void
  mocks.leave.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await dialogButton('Leave team')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  await view.close()
})
test('account deletion requires exact confirmation and locks the dialog during the request', async () => {
  const view = await mount()
  await act(async () =>
    [...view.node.querySelectorAll<HTMLButtonElement>('#danger button')]
      .find((item) => item.textContent === 'Delete account')!
      .click(),
  )
  await dialogButton('Delete account')
  expect(mocks.deleteAccount).not.toHaveBeenCalled()
  await fill(document.body, 'delete-account-confirmation', 'test@example.com')
  let reject!: (error: Error) => void
  mocks.deleteAccount.mockReturnValueOnce(
    new Promise<void>((_, fail) => {
      reject = fail
    }),
  )
  await dialogButton('Delete account')
  expect(
    document
      .getElementById('delete-account-confirmation')
      ?.matches(':disabled'),
  ).toBe(true)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => reject(new TypeError('Failed to fetch')))
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  expect(
    (document.getElementById('delete-account-confirmation') as HTMLInputElement)
      .value,
  ).toBe('test@example.com')
  mocks.deleteAccount.mockResolvedValueOnce(undefined)
  mocks.signOut.mockResolvedValueOnce({})
  mocks.navigate.mockResolvedValueOnce(undefined)
  await dialogButton('Delete account')
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(
    view.node.querySelector<HTMLButtonElement>('#danger button')?.disabled,
  ).toBe(true)
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/auth/login' })
  expect(mocks.clearCache).toHaveBeenCalledOnce()
  await view.close()
})

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect?: () => void
  }) => <button onClick={onSelect}>{children}</button>,
}))
test('disconnect failure stays local and pending retries cannot be dismissed', async () => {
  const view = await mount({
    authMethods: { email: true, github: true, google: false },
    accounts: [
      {
        id: 'github',
        accountId: 'account',
        providerId: 'github',
        managementUrl: null,
        providerAccountName: null,
        providerAccountEmail: null,
        providerAccountUsername: 'user',
        providerAccountImage: null,
      },
    ],
  })
  await act(async () =>
    [...view.node.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Disconnect')!
      .click(),
  )
  mocks.disconnect.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await dialogButton('Disconnect')
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: () => void
  mocks.disconnect.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await dialogButton('Disconnect')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  await view.close()
})

vi.mock('@/lib/resource-cache', () => ({
  invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: mocks.clearCache }),
}))

test('account avatar falls back to initials when the provider image fails', async () => {
  vi.stubGlobal(
    'Image',
    class extends EventTarget {
      complete = false
      naturalWidth = 0
      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event('error')))
      }
    },
  )
  const view = await mount({
    user: {
      ...context.user,
      name: 'Ronan Berder',
      image: 'https://example.com/failed-avatar.jpg',
    },
  })
  try {
    await vi.waitFor(() =>
      expect(
        view.node.querySelector('[data-slot="avatar-fallback"]')?.textContent,
      ).toBe('R'),
    )
    expect(view.node.querySelector('#general img')).toBeNull()
    expect(
      view.node.querySelector('[data-slot="avatar"]')?.className,
    ).toContain('size-10')
  } finally {
    await view.close()
  }
})

test('saving email does not advance the original version of a dirty general draft', async () => {
  const view = await mount({ user: { ...context.user, name: 'Original' } })
  await fill(view.node, 'account-name', 'Draft')
  await fill(view.node, 'account-email', 'new@example.com')
  mocks.email.mockResolvedValueOnce({ settingsVersion: 2 })
  mocks.invalidate.mockImplementationOnce(() =>
    view.render({
      ...context,
      user: { ...context.user, name: 'Original', settingsVersion: 2 },
    }),
  )
  await submitEmail(view.node)
  mocks.save.mockRejectedValueOnce({
    name: 'SettingsConflictError',
    code: 'SETTINGS_CONFLICT',
    message: 'Settings changed.',
  })
  await save(view.node)
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ settingsVersion: 1, name: 'Draft' }),
    }),
  )
  expect(
    view.node.querySelector<HTMLInputElement>('#account-name')!.value,
  ).toBe('Draft')
  await view.close()
})

test('email-change refresh lets a clean General form save against the new version', async () => {
  const initialUser = { ...context.user, name: 'Original' }
  const view = await mount({ user: initialUser })
  await fill(view.node, 'account-email', 'new@example.com')
  mocks.email.mockResolvedValueOnce({ settingsVersion: 2 })
  mocks.invalidate.mockImplementationOnce(() =>
    view.render({ ...context, user: { ...initialUser, settingsVersion: 2 } }),
  )
  await submitEmail(view.node)
  expect(mocks.invalidate).toHaveBeenCalledOnce()
  await fill(view.node, 'account-name', 'Updated')
  mocks.save.mockResolvedValueOnce({
    user: { ...initialUser, name: 'Updated', settingsVersion: 3 },
    fieldErrors: null,
  })
  await save(view.node)
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ settingsVersion: 2, name: 'Updated' }),
    }),
  )
  expect(mocks.error).not.toHaveBeenCalled()
  await view.close()
})
