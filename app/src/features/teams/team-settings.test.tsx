// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { TeamSettings } from './team-settings'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  transfer: vi.fn(),
  role: vi.fn(),
  revoke: vi.fn(),
  deleteTeam: vi.fn(),
  save: vi.fn(),
  bulk: vi.fn(),
  warning: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@/server/teams/functions', () => ({
  updateTeamGeneralAction: mocks.save,
  createTeamInvitesAction: mocks.bulk,
  deleteTeamAction: mocks.deleteTeam,
  removeTeamMemberAction: mocks.remove,
  resendTeamInviteAction: vi.fn(),
  revokeTeamInviteAction: mocks.revoke,
  transferTeamOwnershipAction: mocks.transfer,
  updateTeamMemberRoleAction: mocks.role,
}))
vi.mock('@/lib/team-context-query', () => ({
  setTeamContextQueryData: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.refresh, navigate: mocks.refresh }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/settings-layout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  SettingsSection: ({
    children,
    footer,
    id,
  }: {
    children: ReactNode
    footer: ReactNode
    settingsVersion: 1
    id: string
  }) => (
    <section id={id}>
      {children}
      {footer}
    </section>
  ),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: mocks.success, warning: mocks.warning },
}))
const team = {
  settingsVersion: 1,
  id: 't',
  slug: 'team',
  name: 'Team',
  image: null,
  color: 'lime',
  role: 'owner',
} as const
test('member workspace settings preserve readable fields without management controls', async () => {
  const { node } = await mount({ team: { ...team, role: 'member' } })
  expect(node.querySelector<HTMLInputElement>('#team-name')?.readOnly).toBe(
    true,
  )
  expect(node.querySelector<HTMLInputElement>('#team-slug')?.readOnly).toBe(
    true,
  )
  for (const label of ['Upload image', 'Add members', 'Save']) {
    expect(
      [...node.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === label,
      ),
    ).toBe(false)
  }
  expect(node.querySelector('[aria-label="Copy team ID"]')).not.toBeNull()
})
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(
  overrides: Partial<ComponentProps<typeof TeamSettings>> = {},
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
        <TeamSettings
          team={team}
          canDeleteTeam={false}
          currentUserId="u"
          isDefaultTeam
          invites={[]}
          members={[]}
          {...overrides}
        />
      </TooltipProvider>,
    ),
  )
  const close = async () => {
    if (!node.isConnected) return
    await act(async () => root.unmount())
    node.remove()
  }
  cleanups.push(close)
  return { node, close }
}
async function fill(node: HTMLElement, field: string, value: string) {
  await act(async () => {
    const input = node.querySelector<HTMLInputElement>(`#team-${field}`)!
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(node: HTMLElement) {
  await act(async () => {
    node
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
test('team name and slug validation stays inline and prevents the request', async () => {
  const view = await mount()
  await fill(view.node, 'name', '   ')
  await fill(view.node, 'slug', '-bad')
  await submit(view.node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(view.node.querySelector('#team-name-error')?.textContent).toBe(
    'Enter a team name.',
  )
  expect(view.node.querySelector('#team-slug-error')?.textContent).toContain(
    'Start and end',
  )
  expect(document.activeElement?.id).toBe('team-name')
  expect(mocks.error).not.toHaveBeenCalled()
  await view.close()
})
test('server-side slug conflicts stay inline without clearing entered values', async () => {
  const view = await mount()
  await fill(view.node, 'slug', 'taken')
  mocks.save.mockResolvedValueOnce({
    fieldErrors: { slug: 'A team with this slug already exists.' },
    team: null,
  })
  await submit(view.node)
  expect(view.node.querySelector('#team-slug-error')?.textContent).toContain(
    'already exists',
  )
  expect(view.node.querySelector<HTMLInputElement>('#team-slug')?.value).toBe(
    'taken',
  )
  expect(mocks.success).not.toHaveBeenCalled()
  await view.close()
})
test('general save updates cached team data without refreshing the route', async () => {
  const view = await mount()
  await fill(view.node, 'name', 'Changed')
  let finish!: (value: unknown) => void
  mocks.save.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await submit(view.node)
  expect(
    view.node.querySelector<HTMLInputElement>('#team-name')?.disabled,
  ).toBe(true)
  await act(async () =>
    finish({ fieldErrors: null, team: { ...team, name: 'Changed' } }),
  )
  expect(
    view.node.querySelector<HTMLInputElement>('#team-name')?.disabled,
  ).toBe(false)
  expect(mocks.success).toHaveBeenCalledWith('Team settings saved.')
  expect(mocks.refresh).not.toHaveBeenCalled()
  await view.close()
})

async function openInvite(node: HTMLElement) {
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Add members')!
      .click(),
  )
}
async function fillInvite(value: string) {
  await act(async () => {
    const input = document.getElementById('bulk-invite-emails')!
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submitInvite() {
  await act(async () =>
    document
      .getElementById('bulk-invite-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}
test('invitation validates inline and stays editable after a request failure', async () => {
  const view = await mount()
  await openInvite(view.node)
  await fillInvite('invalid')
  await submitInvite()
  expect(mocks.bulk).not.toHaveBeenCalled()
  expect(
    document.getElementById('bulk-invite-emails-error')?.textContent,
  ).toContain('valid email')
  await fillInvite('user@example.com')
  mocks.bulk.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await submitInvite()
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  expect(
    (document.getElementById('bulk-invite-emails') as HTMLInputElement).value,
  ).toBe('user@example.com')
  await view.close()
})
test('pending invitation blocks duplicate submit, edits, and dismissal', async () => {
  const view = await mount()
  await openInvite(view.node)
  await fillInvite('user@example.com')
  let resolve!: (value: {
    emailCount: number
    emailSentCount: number
    failedEmails: []
  }) => void
  mocks.bulk.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await submitInvite()
  await submitInvite()
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(
    document.getElementById('bulk-invite-emails')?.matches(':disabled'),
  ).toBe(true)
  expect(mocks.bulk).toHaveBeenCalledTimes(1)
  await act(async () =>
    resolve({ emailCount: 1, emailSentCount: 1, failedEmails: [] }),
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
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
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    onSelect: () => void
  }) => <button onClick={onSelect}>{children}</button>,
}))
test('bulk invite validates every email then retains only failed addresses after partial success', async () => {
  const view = await mount()
  await act(async () =>
    [...view.node.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Add members')!
      .click(),
  )
  const fillBulk = async (value: string) => {
    await act(async () => {
      const input = document.getElementById('bulk-invite-emails')!
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const submitBulk = async () => {
    await act(async () =>
      document
        .getElementById('bulk-invite-form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    )
  }
  await fillBulk(', ,')
  await submitBulk()
  expect(mocks.bulk).not.toHaveBeenCalled()
  expect(
    document.getElementById('bulk-invite-emails-error')?.textContent,
  ).toContain('at least one')
  await fillBulk('first@example.com, last@example.com')
  let resolve!: (value: {
    emailCount: number
    emailSentCount: number
    failedEmails: Array<{ email: string; message: string }>
  }) => void
  mocks.bulk.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await submitBulk()
  await submitBulk()
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(
    document.getElementById('bulk-invite-emails')?.matches(':disabled'),
  ).toBe(true)
  expect(mocks.bulk).toHaveBeenCalledTimes(1)
  await act(async () =>
    resolve({
      emailCount: 1,
      emailSentCount: 1,
      failedEmails: [
        { email: 'last@example.com', message: 'Already a member.' },
      ],
    }),
  )
  expect(
    (document.getElementById('bulk-invite-emails') as HTMLTextAreaElement)
      .value,
  ).toBe('last@example.com')
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    'Only failed addresses remain',
  )
  expect(mocks.warning).toHaveBeenCalled()
  expect(mocks.success).not.toHaveBeenCalled()
  await view.close()
})

const targetMember = {
  settingsVersion: 1,
  id: 'membership',
  role: 'member' as const,
  user: {
    settingsVersion: 1,
    id: 'target',
    name: 'Target',
    username: 'target',
    email: 'target@example.com',
    image: null,
  },
}
async function confirmAction(label: string) {
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
async function fillConfirmation(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id)!
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
test.each([
  {
    trigger: 'Remove member',
    action: 'Remove member',
    field: 'remove-member-target',
    value: 'target@example.com',
    mock: mocks.remove,
  },
  {
    trigger: 'Transfer ownership to Target',
    action: 'Transfer ownership',
    field: null,
    value: '',
    mock: mocks.transfer,
  },
  {
    trigger: 'Remove invite',
    action: 'Revoke invite',
    field: null,
    value: '',
    mock: mocks.revoke,
  },
])(
  '$action preserves failure and blocks pending dismissal',
  async ({ trigger, action, field, value, mock }) => {
    const view = await mount({
      members: [targetMember],
      invites: [
        {
          id: 'invite',
          email: 'invite@example.com',
          role: 'member',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          inviter: null,
        },
      ],
    })
    await act(async () =>
      view.node
        .querySelector<HTMLButtonElement>(`button[aria-label="${trigger}"]`)!
        .click(),
    )
    if (field) {
      await confirmAction(action)
      expect(mock).not.toHaveBeenCalled()
      await fillConfirmation(field, value)
    }
    mock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await confirmAction(action)
    expect(mocks.error).toHaveBeenLastCalledWith(
      expect.stringContaining('Unable to connect'),
    )
    let resolve!: () => void
    mock.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done
      }),
    )
    await confirmAction(action)
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    )
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    if (field)
      expect(document.getElementById(field)?.matches(':disabled')).toBe(true)
    await act(async () => resolve())
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    await view.close()
  },
)
test('team deletion requires its slug and cannot repeat after success', async () => {
  const view = await mount({ canDeleteTeam: true, isDefaultTeam: false })
  await act(async () =>
    [...view.node.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Delete team')!
      .click(),
  )
  await confirmAction('Delete team')
  expect(mocks.deleteTeam).not.toHaveBeenCalled()
  await fillConfirmation('delete-team-confirmation', 'team')
  mocks.deleteTeam.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await confirmAction('Delete team')
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: () => void
  mocks.deleteTeam.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await confirmAction('Delete team')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(
    document.getElementById('delete-team-confirmation')?.matches(':disabled'),
  ).toBe(true)
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(
    [...view.node.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === 'Delete team',
    )?.disabled,
  ).toBe(true)
  await view.close()
})

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}))
test('role changes retain failed confirmation and block pending Escape', async () => {
  const view = await mount({ members: [targetMember] })
  await act(async () => {
    const select = view.node.querySelector('select')!
    select.value = 'admin'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  mocks.role.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await confirmAction('Change role')
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: () => void
  mocks.role.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await confirmAction('Change role')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  expect(mocks.role).toHaveBeenLastCalledWith({
    data: { teamSlug: 'team', memberUserId: 'target', role: 'admin' },
  })
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  await view.close()
})

vi.mock('@/lib/resource-cache', () => ({
  invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
}))

test('invitation textarea keeps regular Enter behavior without submitting', async () => {
  const view = await mount()
  await openInvite(view.node)
  await fillInvite('user@example.com')
  const input = document.getElementById(
    'bulk-invite-emails',
  ) as HTMLTextAreaElement
  expect(input.className).toContain('resize-none')
  const requestSubmit = vi
    .spyOn(input.form!, 'requestSubmit')
    .mockImplementation(() => {})
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  expect(requestSubmit).not.toHaveBeenCalled()
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  expect(requestSubmit).not.toHaveBeenCalled()
  requestSubmit.mockRestore()
  await view.close()
})
