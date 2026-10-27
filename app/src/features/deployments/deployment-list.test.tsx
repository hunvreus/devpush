import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import type { DeploymentSummary } from '#devpush/server/projects/types'
import { DeploymentAliasBadge } from './deployment-alias-badge'
import { DeploymentList } from './deployment-list'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('#devpush/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}))
vi.mock('./deployment-actions', () => ({ DeploymentActions: () => null }))

const deployment: DeploymentSummary = {
  id: 'deployment',
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
  createdAt: '2026-10-11T16:05:06.000Z',
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

test('deployment ages expose the original timestamp and full UTC tooltip', () => {
  const html = renderToStaticMarkup(
    <DeploymentList deployments={[deployment]} teamSlug="team" />,
  )
  expect(html).toContain('dateTime="2026-10-11T16:05:06.000Z"')
  expect(html).toContain('Oct 11, 2026, 4:05:06 PM UTC')
  expect(html).toContain('Latest successful deployment')
})

test('Previous explains its relationship to the current deployment', () => {
  expect(
    renderToStaticMarkup(<DeploymentAliasBadge alias="previous" />),
  ).toContain('Previous successful deployment')
})

test.each([
  ['succeeded', 'text-success', 'circle-check'],
  ['failed', 'text-destructive', 'circle-alert'],
  ['canceled', 'text-muted-foreground', 'circle-x'],
] as const)(
  '%s deployment uses the shared status palette',
  (status, color, icon) => {
    const html = renderToStaticMarkup(
      <DeploymentList
        deployments={[{ ...deployment, status }]}
        teamSlug="team"
      />,
    )
    const statusMarkup = html.match(/role="status"[^>]*>(.*?)<\/span>/)?.[1]
    expect(statusMarkup).toContain(color)
    expect(statusMarkup).toContain(icon)
  },
)

test('an empty deployment list never renders a bare bordered list', () => {
  const html = renderToStaticMarkup(
    <DeploymentList deployments={[]} teamSlug="team" />,
  )
  expect(html).toContain('No deployments yet.')
  expect(html).not.toContain('<ul')
})
