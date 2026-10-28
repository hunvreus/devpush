import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'

import { Route as TeamRoute } from './$teamSlug'
import { Route as ProjectRoute } from './$teamSlug.projects.$projectName'
import { Route as ProjectsRoute } from './$teamSlug.projects'
import { Route as DeploymentsRoute } from './$teamSlug.projects.$projectName.deployments'
import { Route as BackupsRoute } from './$teamSlug.projects.$projectName.backups'

const state = vi.hoisted(() => ({
  matches: [] as Array<{ routeId: string }>,
  pathname: '',
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => ({}),
    useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  }),
  Outlet: () => <div>Presented child</div>,
  useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  useChildMatches: ({
    select,
  }: {
    select: (matches: typeof state.matches) => unknown
  }) => select(state.matches),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: state.pathname } }),
  redirect: () => ({}),
}))
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: {
      team: { slug: 'team' },
      project: { name: 'project' },
      projects: [],
      servers: [],
    },
  }),
  useQueryClient: () => ({}),
}))
vi.mock('#devpush/server/auth/context', () => ({
  getCurrentUserContext: vi.fn(),
}))
vi.mock('#devpush/features/teams/use-workspace-updates', () => ({
  useWorkspaceUpdates: () => {},
}))
vi.mock('#devpush/features/teams/team-header', () => ({
  TeamPage: ({ children }: { children: ReactNode }) => (
    <div>Team header{children}</div>
  ),
}))
vi.mock('#devpush/features/teams/team-route-pending', () => ({
  TeamLayoutPending: () => null,
}))
vi.mock('#devpush/features/teams/team-home', () => ({
  TeamProjects: () => <div>Projects list</div>,
}))
vi.mock('#devpush/features/deployments/deployments-page', () => ({
  DeploymentsPage: () => <div>Deployments list</div>,
}))
vi.mock('#devpush/features/projects/project-backups', () => ({
  ProjectBackups: () => <div>Backups list</div>,
}))
vi.mock('#devpush/lib/team-context-query', () => ({
  teamShellQueryOptions: () => ({}),
}))
vi.mock('#devpush/features/projects/project-layout', () => ({
  ProjectPage: ({ children }: { children: ReactNode }) => (
    <div>Project header{children}</div>
  ),
}))
vi.mock('#devpush/features/projects/project-overview', () => ({
  ProjectOverview: () => <div>Project overview</div>,
}))
vi.mock('#devpush/features/projects/project-route-pending', () => ({
  ProjectRoutePending: () => null,
}))
vi.mock('#devpush/lib/project-context-query', () => ({
  projectShellQueryOptions: () => ({}),
  projectContextQueryOptions: () => ({}),
}))
vi.mock('#devpush/lib/use-refresh-error', () => ({ useRefreshError: () => {} }))

test('team layout retains the header while a project URL is pending but the team page is still presented', () => {
  state.pathname = '/team/projects/project/deployments/id'
  state.matches = [{ routeId: '/$teamSlug/' }]
  const Component = TeamRoute.options.component!
  const html = renderToStaticMarkup(<Component />)
  expect(html).toContain('Team header')
  expect(html).toContain('Presented child')
})

test('project layout does not replace a presented deployment with the overview when the URL changes', () => {
  state.pathname = '/team/projects/project'
  state.matches = [{ routeId: '/$teamSlug/projects/$projectName/deployments' }]
  const Component = ProjectRoute.options.component!
  const html = renderToStaticMarkup(<Component />)
  expect(html).toContain('Project header')
  expect(html).toContain('Presented child')
  expect(html).not.toContain('Project overview')
})

test.each([
  ['projects', ProjectsRoute, '/team/projects', 'Projects list'],
  [
    'deployments',
    DeploymentsRoute,
    '/team/projects/project/deployments',
    'Deployments list',
  ],
  ['backups', BackupsRoute, '/team/projects/project/backups', 'Backups list'],
] as const)(
  '%s keeps the presented child while navigating to its list',
  (_, route, pathname, list) => {
    state.pathname = pathname
    state.matches = [{ routeId: 'child' }]
    const Component = route.options.component!
    const html = renderToStaticMarkup(<Component />)
    expect(html).toContain('Presented child')
    expect(html).not.toContain(list)
  },
)

test.each([
  ['projects', ProjectsRoute, '/team/projects/project', 'Projects list'],
  [
    'deployments',
    DeploymentsRoute,
    '/team/projects/project/deployments/id',
    'Deployments list',
  ],
  [
    'backups',
    BackupsRoute,
    '/team/projects/project/backups/id',
    'Backups list',
  ],
] as const)(
  '%s keeps the presented list while navigating to a child',
  (_, route, pathname, list) => {
    state.pathname = pathname
    state.matches = []
    const Component = route.options.component!
    const html = renderToStaticMarkup(<Component />)
    expect(html).toContain(list)
    expect(html).not.toContain('Presented child')
  },
)
