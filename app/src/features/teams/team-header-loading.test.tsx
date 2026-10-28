// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReactNode, Ref } from 'react'
import { TeamPage } from './team-header'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { projectContext } from '#devpush/test/project-context'

const hydration = vi.hoisted(() => ({ ready: true }))
const navigation = vi.hoisted(() => ({
  deploymentId: '',
  location: '/team',
  resolved: '/team',
}))
const inviteActions = vi.hoisted(() => ({
  decline: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('#devpush/server/teams/functions', () => ({
  acceptUserTeamInviteAction: vi.fn(),
  declineUserTeamInviteAction: inviteActions.decline,
}))
afterEach(() => {
  hydration.ready = true
  navigation.deploymentId = ''
  navigation.location = '/team'
  navigation.resolved = '/team'
  inviteActions.decline.mockReset()
  inviteActions.invalidate.mockReset()
})

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => hydration.ready,
  useParams: () => ({
    teamSlug: 'team',
    projectName: navigation.deploymentId ? 'project' : undefined,
    deploymentId: navigation.deploymentId || undefined,
  }),
  useRouterState: ({
    select,
  }: {
    select: (state: {
      location: { pathname: string }
      resolvedLocation: { pathname: string }
    }) => unknown
  }) =>
    select({
      location: { pathname: navigation.location },
      resolvedLocation: { pathname: navigation.resolved },
    }),
  useRouter: () => ({ invalidate: inviteActions.invalidate }),
  Link: ({
    children,
    ref,
    'aria-label': label,
    role,
    'aria-selected': selected,
  }: {
    children: ReactNode
    ref?: Ref<HTMLAnchorElement>
    'aria-label'?: string
    role?: string
    'aria-selected'?: boolean
  }) => (
    <a
      ref={ref}
      href="#"
      aria-label={label}
      role={role}
      aria-selected={selected}
    >
      {children}
    </a>
  ),
}))
vi.mock('./new-team-dialog', () => ({ NewTeamDialogLauncher: () => null }))
vi.mock('#devpush/features/repositories/new-project-dialog-launcher', () => ({
  NewProjectDialogLauncher: () => null,
}))
vi.mock('#devpush/features/auth/sign-out-menu-item', () => ({
  SignOutMenuItem: () => null,
}))

function header(known: boolean) {
  const client = new QueryClient()
  if (known)
    client.setQueryData(['team-context', 'team', 'shell'], projectContext)
  const node = document.createElement('div')
  node.innerHTML = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TeamPage>{null}</TeamPage>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  return node
}

test('loading avatar retains the loaded menu button dimensions and circle', () => {
  const pending = header(false).querySelector<HTMLButtonElement>(
    '[aria-label="User menu loading"]',
  )!
  const loaded = header(true).querySelector<HTMLButtonElement>(
    'button[aria-label="User menu"]',
  )!
  expect(pending.disabled).toBe(true)
  expect(pending.dataset.size).toBe(loaded.dataset.size)
  expect(pending.className).toBe(loaded.className)
  expect(pending.classList.contains('size-7')).toBe(true)
  const skeleton = pending.querySelector('[data-slot="skeleton"]')!
  const avatar = loaded.querySelector('[data-slot="avatar"]')!
  for (const className of ['size-6', 'shrink-0', 'rounded-full']) {
    expect(skeleton.classList.contains(className)).toBe(true)
    expect(avatar.classList.contains(className)).toBe(true)
  }
})

test('cached user keeps their real avatar during route loading', () => {
  const node = header(true)
  expect(node.querySelector('[aria-label="User menu loading"]')).toBeNull()
  expect(
    node.querySelector('[aria-label="User menu"] [data-slot="avatar"]'),
  ).not.toBeNull()
})

test('selected tab follows the displayed page while the next route loads', () => {
  navigation.deploymentId = 'deployment-current'
  navigation.location = '/team/projects/project'
  navigation.resolved = '/team/projects/project/deployments/deployment-current'
  const client = new QueryClient()
  const node = document.createElement('div')
  node.innerHTML = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TeamPage projectNavigation>{null}</TeamPage>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  const tabs = [...node.querySelectorAll('[role="tab"]')]
  expect(
    tabs
      .find((tab) => tab.textContent.includes('Deployments'))
      ?.getAttribute('aria-selected'),
  ).toBe('true')
  expect(
    tabs
      .find((tab) => tab.textContent.includes('Overview'))
      ?.getAttribute('aria-selected'),
  ).toBe('false')
  client.clear()
})

test('pre-hydration navigation ignores a cache populated ahead of hydration', () => {
  hydration.ready = false
  const withoutCache = header(false)
  const withCache = header(true)
  expect(withCache.textContent).toBe(withoutCache.textContent)
  expect(
    withCache.querySelector('[aria-label="User menu loading"]'),
  ).not.toBeNull()
  expect(withCache.querySelector('[aria-label="Team loading"]')).not.toBeNull()
})

test('deployment header observes detail updates and renders the pending selector without guessing status', async () => {
  navigation.deploymentId = 'deployment-current'
  const client = new QueryClient()
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <TeamPage
            currentProject={projectContext.project}
            currentTeam={projectContext.team}
            userContext={projectContext.userContext}
          >
            {null}
          </TeamPage>
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  )
  expect(
    node.querySelector<HTMLButtonElement>('[aria-label="Switch deployment"]')
      ?.disabled,
  ).toBe(true)
  expect(
    node.querySelector('[aria-label="Deployment deploym: loading"]'),
  ).not.toBeNull()
  const key = ['deployment-context', 'team', 'project', 'deployment-current']
  await act(async () =>
    client.setQueryData(key, {
      deployment: { id: 'deployment-current', status: 'running' },
      latestDeployments: [{ id: 'other-deployment', status: 'running' }],
    }),
  )
  await vi.waitFor(() =>
    expect(
      node.querySelector('[aria-label="Deployment deploym: running"]'),
    ).not.toBeNull(),
  )
  expect(
    node.querySelector<HTMLButtonElement>('[aria-label="Switch deployment"]')
      ?.disabled,
  ).toBe(false)
  await act(async () =>
    node
      .querySelector('[aria-label="Switch deployment"]')
      ?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      ),
  )
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Deployment other-d: running"]'),
    ).not.toBeNull(),
  )
  await act(async () =>
    client.setQueryData(key, {
      deployment: { id: 'deployment-current', status: 'succeeded' },
      latestDeployments: [{ id: 'other-deployment', status: 'failed' }],
    }),
  )
  await vi.waitFor(() =>
    expect(
      node.querySelector('[aria-label="Deployment deploym: succeeded"]'),
    ).not.toBeNull(),
  )
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Deployment other-d: failed"]'),
    ).not.toBeNull(),
  )
  await act(async () => root.unmount())
  node.remove()
  client.clear()
})

test.each([1, 10])(
  'header shows %i invitations while About follows Help in the user menu',
  async (count) => {
    const client = new QueryClient()
    const node = document.createElement('div')
    document.body.append(node)
    const root = createRoot(node)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const userContext = {
      ...projectContext.userContext,
      invites: [
        {
          id: 'invite',
          role: 'member' as const,
          createdAt: '2026-10-11',
          expiresAt: '2026-10-18',
          team: {
            id: 'other',
            slug: 'other',
            name: 'Invited team',
            image: null,
            color: 'blue' as const,
          },
          inviter: null,
        },
      ],
    }
    userContext.invites = Array.from({ length: count }, (_, index) => ({
      ...userContext.invites[0]!,
      id: `invite-${index}`,
    }))
    const openMenu = async () => {
      await act(async () =>
        node
          .querySelector('button[aria-label="User menu"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }),
          ),
      )
      await vi.waitFor(() =>
        expect(document.querySelector('[role="menu"]')).not.toBeNull(),
      )
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <TooltipProvider>
              <TeamPage userContext={userContext}>{null}</TeamPage>
            </TooltipProvider>
          </QueryClientProvider>,
        ),
      )
      expect(node.querySelector('button[aria-label="Help"]')).toBeNull()
      expect(
        node.querySelector('button[aria-label="Notifications"]'),
      ).not.toBeNull()
      expect(
        node.querySelector('button[aria-label="About devpush"]'),
      ).toBeNull()
      expect(
        node.querySelector('button[aria-label="User menu"] .bg-destructive'),
      ).toBeNull()
      await openMenu()
      expect(
        document.querySelector('a[href="https://devpu.sh/docs"]'),
      ).not.toBeNull()
      expect(
        document.querySelector('a[href="https://devpu.sh/docs"]')?.textContent,
      ).toBe('Help')
      expect(
        document.querySelector('a[href="https://devpu.sh/chat"]'),
      ).toBeNull()
      expect(
        document.querySelector('[role="menu"]')?.textContent,
      ).not.toContain('Default team')
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        'Account',
      )
      expect(
        document.querySelector('[role="menu"]')?.textContent,
      ).not.toContain('Account settings')
      const menuItem = (label: string) =>
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (item) => item.textContent.includes(label),
        )!
      expect(menuItem('Notifications')).toBeUndefined()
      expect(menuItem('Help').nextElementSibling).toBe(
        menuItem('About devpush'),
      )
      expect(
        menuItem('Help').querySelector('svg.lucide-arrow-up-right.opacity-50'),
      ).not.toBeNull()
      const notificationButton = node.querySelector(
        'button[aria-label="Notifications"]',
      )!
      expect(notificationButton.textContent).toBe('')
      expect(
        notificationButton.querySelector('.size-2.ring-2.ring-background'),
      ).not.toBeNull()
      await act(async () => menuItem('About devpush').click())
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Version',
      )
      expect(document.querySelector('[role="menu"]')).toBeNull()
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>('button[aria-label="Close"]')
          ?.click(),
      )
      // Dialog close button has visible/sr-only text rather than an aria-label.
      if (document.querySelector('[role="dialog"]'))
        await act(async () =>
          [
            ...document.querySelectorAll<HTMLButtonElement>(
              '[role="dialog"] button',
            ),
          ]
            .find((button) => button.textContent === 'Close')
            ?.click(),
        )
      await act(async () =>
        node
          .querySelector('button[aria-label="Notifications"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }),
          ),
      )
      await vi.waitFor(() => expect(menuItem('Invited team')).toBeDefined())
      expect(menuItem('Invited team').textContent).toContain('ago')
      expect(menuItem('Invited team').textContent).not.toContain('Invited as')
      await act(async () => menuItem('Invited team').click())
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Invitation to "Invited team"',
      )
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Invited team',
      )
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'October 18, 2026',
      )
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Member',
      )
      const description = document.querySelector(
        '[data-slot="dialog-header"] [data-slot="dialog-description"]',
      )!
      expect(description.textContent).toContain(
        'This invitation will expire on',
      )
      expect(description.classList.contains('text-muted-foreground')).toBe(true)
      expect(description.classList.contains('text-foreground')).toBe(false)
      expect(
        [...document.querySelectorAll('[role="dialog"] dl dt')].map(
          (label) => label.textContent,
        ),
      ).toEqual(['Team', 'Role'])
      expect(document.querySelector('[role="menu"]')).toBeNull()
      inviteActions.decline.mockResolvedValueOnce(undefined)
      await act(async () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[role="dialog"] button',
          ),
        ]
          .find((button) => button.textContent === 'Decline invitation')!
          .click(),
      )
      expect(inviteActions.decline).toHaveBeenCalledWith({
        data: { inviteId: expect.any(String) },
      })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(inviteActions.invalidate).toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      node.remove()
      client.clear()
      vi.unstubAllGlobals()
    }
  },
)
