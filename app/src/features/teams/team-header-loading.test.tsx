// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { TeamPage } from './team-header'
import { TooltipProvider } from '@/components/ui/tooltip'
import { projectContext } from '@/test/project-context'

const hydration = vi.hoisted(() => ({ ready: true }))
const navigation = vi.hoisted(() => ({ deploymentId: '' }))
afterEach(() => {
  hydration.ready = true
  navigation.deploymentId = ''
})

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => hydration.ready,
  useParams: () => ({
    teamSlug: 'team',
    projectName: navigation.deploymentId ? 'project' : undefined,
    deploymentId: navigation.deploymentId || undefined,
  }),
  useRouterState: () => '/team',
  useRouter: () => ({}),
  Link: ({
    children,
    'aria-label': label,
  }: {
    children: ReactNode
    'aria-label'?: string
  }) => <a aria-label={label}>{children}</a>,
}))
vi.mock('./new-team-dialog', () => ({ NewTeamDialogLauncher: () => null }))
vi.mock('@/features/repositories/new-project-dialog-launcher', () => ({
  NewProjectDialogLauncher: () => null,
}))
vi.mock('@/features/auth/sign-out-menu-item', () => ({
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
