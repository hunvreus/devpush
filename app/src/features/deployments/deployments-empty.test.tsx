import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import { projectContext } from '#devpush/test/project-context'
import type { DeploymentSummary } from '#devpush/server/projects/types'
import { DeploymentsPage } from './deployments-page'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  useRouter: () => ({ navigate: vi.fn() }),
}))
vi.mock('#devpush/features/projects/project-heading', () => ({
  ProjectHeading: () => null,
}))
vi.mock('#devpush/features/projects/manual-deploy-dialog', () => ({
  ManualDeployDialog: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('#devpush/features/deployments/deployment-list', () => ({
  DeploymentList: ({ deployments }: { deployments: DeploymentSummary[] }) => (
    <ul aria-label="Deployments">
      {deployments.map((item) => (
        <li key={item.id}>{item.id}</li>
      ))}
    </ul>
  ),
}))
const deployment: DeploymentSummary = {
  id: 'successful-deployment',
  status: 'succeeded',
  phase: null,
  trigger: 'user',
  gitSha: '12345678',
  gitBranch: 'main',
  githubRepo: 'owner/repo',
  deploymentHost: null,
  deploymentRouteHttps: true,
  commitMessage: null,
  errorMessage: null,
  createdAt: '2026-10-16T00:00:00Z',
  startedAt: null,
  finishedAt: null,
  environmentName: 'Production',
  environmentSlug: 'production',
  environmentColor: 'blue',
  serverId: null,
  serverName: 'Server',
  serverStatus: 'connected',
  projectName: 'project',
  projectColor: 'blue',
}

test.each([
  { status: 'failed' },
  { branch: 'other' },
  { environment: 'staging' },
  { date: 'today' },
])(
  'empty filter results render an explanation instead of an empty list: %j',
  (filters) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
    try {
      const html = renderToStaticMarkup(
        <DeploymentsPage
          context={{ ...projectContext, deployments: [deployment] }}
          filters={filters}
        />,
      )
      expect(html).toContain('No matching deployments.')
      expect(html).toContain('Reset filters')
      expect(html).not.toContain('aria-label="Deployments"')
      expect(html).not.toContain('No deployments yet.')
    } finally {
      vi.useRealTimers()
    }
  },
)

test('a project with no deployments shows its initial deployment action', () => {
  const html = renderToStaticMarkup(
    <DeploymentsPage context={projectContext} filters={{}} />,
  )
  expect(html).toContain('No deployments yet.')
  expect(html).toContain('Deploy</button>')
  expect(html).not.toContain('No matching deployments.')
})

test('matching deployments render the list', () => {
  const html = renderToStaticMarkup(
    <DeploymentsPage
      context={{ ...projectContext, deployments: [deployment] }}
      filters={{ status: 'succeeded' }}
    />,
  )
  expect(html).toContain('successful-deployment')
  expect(html).not.toContain('data-slot="empty"')
})
