import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { projectContext } from '#devpush/test/project-context'
import type { ServerSummary } from '#devpush/server/teams/types'
import { ProjectPage } from '#devpush/features/projects/project-layout'
import { ServerAvailabilityAlert } from './server-availability-alert'
import { getServerAvailabilityNotice } from './server-availability'

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => true,
  Link: ({
    children,
    to,
    hash,
    params,
  }: {
    children: ReactNode
    to: string
    hash?: string
    params: Record<string, string>
  }) => (
    <a
      href={to + (hash ? `#${hash}` : '')}
      data-params={JSON.stringify(params)}
    >
      {children}
    </a>
  ),
}))
vi.mock('#devpush/features/teams/team-header', () => ({
  TeamPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const server: ServerSummary = {
  id: 'server-id',
  name: 'Test server',
  publicAddress: null,
  status: 'disconnected',
  agentVersion: null,
  agentUpdate: { status: 'current', latestVersion: null, reason: null },
  lastSeenAt: null,
  monitoring: {
    availabilityPercent: null,
    availabilityWindowMs: 0,
    latestMetrics: null,
  },
}
const notice = getServerAvailabilityNotice([server])!
const ready = {
  ...projectContext,
  project: {
    ...projectContext.project,
    runtimeConfig: {
      ...projectContext.project.runtimeConfig,
      path: 'compose.yml',
    },
  },
}
const assigned = {
  ...ready,
  environments: projectContext.environments.map((environment) => ({
    ...environment,
    effectiveServerId: server.id,
  })),
  servers: [server],
}

test.each(['owner', 'admin', 'member'] as const)(
  '%s gets the same neutral server link in workspace and project notices',
  (role) => {
    const team = { ...projectContext.team, role }
    const workspace = renderToStaticMarkup(
      <ServerAvailabilityAlert notice={notice} team={team} />,
    )
    const project = renderToStaticMarkup(
      <ProjectPage context={{ ...assigned, team }}>
        Project content
      </ProjectPage>,
    )
    for (const html of [workspace, project]) {
      expect(html).toContain('1 server is disconnected')
      expect(html).toContain('View server')
      expect(html).toContain('href="/$teamSlug/servers/$serverId"')
      expect(html).toContain('server-id')
      expect(html).not.toContain('text-destructive')
      expect(html).not.toContain('/settings')
    }
  },
)

test('members can view the affected server and get contact guidance in either view', () => {
  const team = { ...projectContext.team, role: 'member' as const }
  const workspace = renderToStaticMarkup(
    <ServerAvailabilityAlert notice={notice} team={team} />,
  )
  const project = renderToStaticMarkup(
    <ProjectPage context={{ ...assigned, team }}>Project content</ProjectPage>,
  )
  for (const html of [workspace, project]) {
    expect(html).toContain('Test server is disconnected.')
    expect(html).toContain('Contact a workspace owner or admin')
    expect(html).toContain('View server')
    expect(html).toContain('href="/$teamSlug/servers/$serverId"')
    expect(html).toContain('server-id')
    expect(html).not.toContain('text-destructive')
  }
})

test('project notices only concern assigned servers', () => {
  const html = renderToStaticMarkup(
    <ProjectPage
      context={{
        ...assigned,
        servers: [
          { ...server, status: 'connected' },
          { ...server, id: 'unrelated', status: 'disconnected' },
        ],
      }}
    >
      Project content
    </ProjectPage>,
  )
  expect(html).not.toContain('data-slot="alert"')
})

test.each(['pending', 'disabled'] as const)(
  '%s assigned servers also link to their detail page',
  (status) => {
    const html = renderToStaticMarkup(
      <ProjectPage context={{ ...assigned, servers: [{ ...server, status }] }}>
        Project content
      </ProjectPage>,
    )
    expect(html).toContain('Project server unavailable')
    expect(html).toContain('href="/$teamSlug/servers/$serverId"')
    expect(html).not.toContain('/settings')
  },
)

test('missing assignments lead to project server settings', () => {
  const html = renderToStaticMarkup(
    <ProjectPage context={ready}>Project content</ProjectPage>,
  )
  expect(html).toContain('No server assigned')
  expect(html).toContain(
    'href="/$teamSlug/projects/$projectName/settings#servers"',
  )
  expect(html).not.toContain('text-destructive')
})

test('deleted assigned servers lead to project server settings instead of a missing server page', () => {
  const html = renderToStaticMarkup(
    <ProjectPage context={{ ...assigned, servers: [] }}>
      Project content
    </ProjectPage>,
  )
  expect(html).toContain('Project server missing')
  expect(html).toContain(
    'href="/$teamSlug/projects/$projectName/settings#servers"',
  )
})
