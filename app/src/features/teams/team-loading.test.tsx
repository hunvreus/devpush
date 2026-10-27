import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { TeamLayoutPending, TeamSettingsPending } from './team-route-pending'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { projectContext } from '#devpush/test/project-context'

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => true,
  getRouteApi: () => ({ useLoaderData: () => undefined }),
  useParams: () => ({ teamSlug: 'team' }),
  useRouterState: () => '/team',
  useRouter: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./team-header', () => ({
  TeamPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))
vi.mock('#devpush/features/servers/team-servers', () => ({
  AddServerDialog: () => null,
  TeamServers: () => null,
}))
vi.mock('#devpush/features/repositories/new-project-dialog-launcher', () => ({
  NewProjectDialogLauncher: () => null,
}))

function render(knownEmpty: boolean, cachedDeployments = false) {
  const client = new QueryClient()
  if (knownEmpty)
    client.setQueryData(['team-context', 'team', 'shell'], {
      ...projectContext,
      projects: [],
      servers: [],
    })
  if (cachedDeployments) {
    client.setQueryData(['team-context', 'team', 'shell'], {
      ...projectContext,
      projects: [projectContext.project],
      servers: [],
    })
    client.setQueryData(['team-context', 'team', 'section', 'overview'], {
      section: 'overview',
      deployments: [],
    })
  }
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TeamLayoutPending />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  return html
}
test('unknown team data loads project and deployment rows, not an empty-state silhouette', () => {
  const html = render(false)
  expect(html).toContain('Recent projects')
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*>[\s\S]*?New project<\/button>/,
  )
  expect(html).toContain('Latest deployments')
  expect(html).not.toContain('min-h-60')
  expect(html).not.toContain('Connect your first server')
})
test('known empty data immediately renders the real onboarding state', () => {
  const html = render(true)
  expect(html).toContain('Connect your first server.')
  expect(html).not.toContain('Team overview loading')
  expect(html).not.toContain('Latest deployments loading')
})

test('cached empty deployment results are not replaced with skeletons during refresh', () => {
  expect(render(false, true)).not.toContain('Latest deployments loading')
})

test.each(['unknown', 'owner', 'default', 'member'] as const)(
  'danger zone displays the known restriction or disabled action (%s)',
  (state) => {
    const client = new QueryClient()
    if (state !== 'unknown')
      client.setQueryData(['team-context', 'team', 'shell'], {
        ...projectContext,
        team: {
          ...projectContext.team,
          role: state === 'member' ? 'member' : 'owner',
        },
        userContext: {
          ...projectContext.userContext,
          user: {
            ...projectContext.userContext.user,
            defaultTeamId: state === 'default' ? 't' : 'other',
          },
        },
      })
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <TeamSettingsPending />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    client.clear()
    expect(html).not.toContain('Loading deletion eligibility')
    if (state === 'default') expect(html).toContain('This is your default team')
    else if (state === 'member')
      expect(html).toContain('Only team owners can delete a team')
    else
      expect(html).toMatch(
        /<button[^>]*disabled=""[^>]*>[\s\S]*?Delete team<\/button>/,
      )
    if (state === 'default' || state === 'member')
      expect(html).not.toContain('Delete team')
  },
)

test.each([true, false])(
  'workspace settings retain disabled management controls (cached=%s)',
  (known) => {
    const client = new QueryClient()
    if (known)
      client.setQueryData(['team-context', 'team', 'shell'], {
        ...projectContext,
        projects: [],
        servers: [],
      })
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <TeamSettingsPending />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    client.clear()
    expect(html).toContain('Add members')
    expect(html).not.toContain('More member actions')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
    if (known) {
      expect(html).toContain('aria-label="Copy team ID"')
      expect(html).toContain('value="Team"')
    }
  },
)
