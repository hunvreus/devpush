import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { projectContext } from '#devpush/test/project-context'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { ProjectSectionPending } from './project-route-pending'

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => true,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouterState: () => ({}),
  useRouter: () => ({}),
  useParams: () => ({
    teamSlug: 'team',
    projectName: 'project',
    deploymentId: 'd',
  }),
}))
vi.mock('./project-heading', () => ({
  ProjectHeading: ({ actions }: { actions?: ReactNode }) => <>{actions}</>,
}))

test('unknown project settings show rows instead of claiming collections are empty', () => {
  const client = new QueryClient()
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="settings" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).not.toContain('No environment variables.')
  expect(html).not.toContain('No custom domains.')
  expect(html).toContain('Environment variables')
  expect(html).toContain('Domains')
  expect(html).toContain('data-slot="skeleton"')
})

vi.mock('./manual-deploy-dialog', () => ({ ManualDeployDialog: () => null }))
test('cached empty project deployments render immediately during refresh', () => {
  const client = new QueryClient()
  const context = { ...projectContext, deployments: [] }
  client.setQueryData(['project-context', 'team', 'project', 'shell'], context)
  client.setQueryData(
    ['project-context', 'team', 'project', 'overview'],
    context,
  )
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="overview" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).toContain('No deployments yet.')
  expect(html).not.toContain('Latest deployments loading')
})

test.each([
  'overview',
  'deployments',
  'deployment',
  'logs',
  'backups',
  'backup',
  'settings',
] as const)('unknown %s data never claims a collection is empty', (section) => {
  const client = new QueryClient()
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section={section} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  if (section === 'backup') {
    expect(html).toContain('aria-label="Loading backup policy"')
    expect(html).toContain('<fieldset disabled=""')
    expect(html).toContain('Volumes loading')
    expect(html).toContain('Databases loading')
    expect(html).not.toContain('data-slot="empty"')
    for (const label of [
      'General',
      'Remote backups',
      'Retention',
      'Volumes',
      'Databases',
      'Delete policy',
    ]) {
      expect(html).toContain(label)
    }
  } else if (section === 'backups') {
    for (const label of [
      'Policies',
      'Activity',
      'All types',
      'Create policy',
      'All environments',
      'All statuses',
      'All servers',
      'All dates',
      'Restore',
    ])
      expect(html).toContain(label)
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain('Loading backups…')
  } else if (section === 'logs') expect(html).toContain('Loading logs')
  else expect(html).toContain('data-slot="skeleton"')
  if (section === 'deployment') {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Visit<\/button>/)
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Deployment options"/,
    )
  }
  expect(html).not.toMatch(
    /No (deployments|logs|backup|environment variables|custom domains)/,
  )
})

test('known empty deployment list stays visible while its route reloads', () => {
  const client = new QueryClient()
  client.setQueryData(['project-context', 'team', 'project', 'deployments'], {
    ...projectContext,
    deployments: [],
  })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="deployments" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).toContain('No deployments yet.')
  expect(html).not.toContain('data-slot="skeleton"')
})

test('unknown log results keep known filters and use a loading message', () => {
  const client = new QueryClient()
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="logs" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).toContain('All deployments')
  expect(html).toContain('All environments')
  expect(html).toContain('All dates')
  expect(html).toContain('All branches')
  expect(html).toContain('items-center justify-center')
  expect(html).toContain('animate-spin')
  expect(html).toContain('Find in logs')
  expect(html).toContain('Loading logs')
  expect(html).not.toContain('data-slot="skeleton"')
})

test('settings loading keeps cached identity and environment fields instead of placeholders', () => {
  const client = new QueryClient()
  client.setQueryData(
    ['project-context', 'team', 'project', 'shell'],
    projectContext,
  )
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="settings" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).toContain('owner/repo')
  expect(html).toContain('value="p"')
  expect(html).toContain('aria-label="Copy project ID"')
  expect(html).toContain('value="Production"')
  expect(html).toContain('value="production"')
  expect(html).toContain('value="main"')
  expect(html).toContain('aria-label="View on GitHub"')
})

test('deployment loading renders the known logs action as a disabled button', () => {
  const client = new QueryClient()
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="deployment" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>All logs/)
})

test('cached empty log results stay visible during route loading', () => {
  const client = new QueryClient()
  client.setQueryData(
    ['project-logs', 'team', 'project', null, null, null, null, null],
    {
      ...projectContext,
      logs: [],
      hasAnyLogs: false,
      filters: {
        branch: null,
        date: null,
        deploymentId: null,
        environmentId: null,
        keyword: null,
      },
    },
  )
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="logs" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).not.toContain('Loading logs')
  expect(html).not.toContain('data-slot="skeleton"')
  expect(html).toContain('No logs')
})

test('deployment loading uses real metadata icons and a centered log loader', () => {
  const client = new QueryClient()
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="deployment" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  expect(html).toContain('lucide-clock-3')
  expect(html).toContain('lucide-server')
  expect(html).toContain('lucide-git-branch')
  expect(html).toContain('lucide-git-commit-horizontal')
  expect(html).toContain('lucide-loader')
  expect(html).toMatch(
    /role="status" class="flex h-full items-center justify-center/,
  )
  expect(html).toContain('Loading logs')
  expect(html).not.toContain('Loading logs…')
  expect(html).not.toContain('h-5 w-16')
})

test('deployment loading shows metadata already known from the project list', () => {
  const client = new QueryClient()
  client.setQueryData(['project-context', 'team', 'project', 'deployments'], {
    ...projectContext,
    deployments: [
      {
        id: 'd',
        status: 'succeeded',
        phase: null,
        trigger: 'webhook',
        gitSha: 'abcdef',
        gitBranch: 'main',
        githubRepo: 'owner/repo',
        deploymentHost: null,
        deploymentRouteHttps: true,
        commitMessage: 'Known commit',
        errorMessage: null,
        createdAt: '2026-10-07T00:00:00Z',
        startedAt: '2026-10-07T00:00:00Z',
        finishedAt: '2026-10-07T00:00:10Z',
        environmentName: 'Production',
        environmentSlug: 'production',
        environmentColor: 'lime',
        serverId: 's',
        serverName: 'Known server',
        serverStatus: 'connected',
        projectName: 'project',
        projectColor: 'lime',
      },
    ],
  })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ProjectSectionPending section="deployment" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  for (const text of [
    'Succeeded',
    '10s',
    'Production',
    'Known server',
    'main',
    'Known commit',
  ])
    expect(html).toContain(text)
  expect(html).not.toContain('data-slot="skeleton"')
})

// Assert the visible value, not the trigger's accessible label. Radix renders
// its placeholder instead of children when the select has no value.
test.each([
  [
    'deployments',
    ['All environments', 'All statuses', 'All dates', 'All branches'],
  ],
  [
    'logs',
    ['All deployments', 'All environments', 'All dates', 'All branches'],
  ],
  [
    'backups',
    [
      'All policies',
      'All types',
      'All environments',
      'All statuses',
      'All servers',
      'All dates',
    ],
  ],
] as const)(
  '%s loading renders default labels inside disabled filters',
  (section, labels) => {
    const client = new QueryClient()
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ProjectSectionPending section={section} />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    client.clear()
    const values = [
      ...html.matchAll(/data-slot="select-value"[^>]*>(.*?)<\/span>/g),
    ].map((match) => match[1])
    expect(values).toEqual(labels)
  },
)
