// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { projectContext } from '#devpush/test/project-context'
import type { ServerDetail } from '#devpush/server/servers/service'
import { ServerDetailPending } from './server-detail-pending'
import { ServerDetail as ServerDetailView } from './server-detail'
import type { ServerSummary } from '#devpush/server/teams/types'

vi.mock('#devpush/server/servers/functions', () => ({
  getTeamServerMetricHistory: vi.fn(() => new Promise(() => {})),
}))

const hydration = vi.hoisted(() => ({ ready: true }))

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => hydration.ready,
  getRouteApi: () => ({ useLoaderData: () => undefined }),
  useParams: () => ({ teamSlug: 'team', serverId: 'server-id' }),
  useRouter: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
const server: ServerSummary = {
  id: 'server-id',
  name: 'Test server',
  publicAddress: null,
  status: 'pending',
  agentVersion: null,
  agentUpdate: { status: 'current', latestVersion: null, reason: null },
  lastSeenAt: null,
  monitoring: {
    availabilityPercent: null,
    availabilityWindowMs: 0,
    latestMetrics: null,
  },
}
const emptyDetail: ServerDetail = {
  settingsVersion: 1,
  ...server,
  agentProtocolVersion: null,
  agentCapabilities: null,
  hostname: null,
  operatingSystem: null,
  kernelVersion: null,
  architecture: null,
  cpuCoreCount: null,
  hostUptimeSeconds: null,
  createdAt: '2026-10-07T12:00:00Z',
  updatedAt: '2026-10-07T12:00:00Z',
}

function render(
  role: 'owner' | 'admin' | 'member',
  known = true,
  summary = server,
) {
  const client = new QueryClient()
  if (known)
    client.setQueryData(['team-context', 'team', 'shell'], {
      ...projectContext,
      team: { ...projectContext.team, role },
      projects: [],
      servers: [summary],
    })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ServerDetailPending />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  client.clear()
  return html
}
test('known shell enrollment preserves identity without claiming metrics are empty', () => {
  const html = render('owner')
  expect(html).toContain('Install agent')
  expect(html).toContain('Test server')
  expect(html).toContain('value="server-id"')
  expect(html).not.toContain('No metrics reported yet.')
  expect(html).toContain('Not reported')
  expect(html).toContain('CPU usage')
  expect(html.match(/Loading data…/g)).toHaveLength(4)
})
test('read-only members never receive management placeholders', () => {
  const html = render('member')
  expect(html).not.toContain('Install agent')
  expect(html).not.toContain('Disable server')
  expect(html).not.toContain('Delete server')
  expect(html).not.toContain('>Save<')
})
test('unknown server data keeps all chart layouts without inventing readings', () => {
  const html = render('member', false)
  expect(html.match(/Loading data…/g)).toHaveLength(4)
  expect(html).toContain('value="server-id"')
  for (const label of [
    'CPU usage',
    'Memory usage',
    'Disk usage',
    'Network traffic',
  ])
    expect(html).toContain(label)
  expect(html.match(/flex h-40 items-center justify-center/g)).toHaveLength(4)
  expect(html).not.toContain('No metrics reported yet.')
})

test.each(['owner', 'admin'] as const)(
  'pending %s controls keep the general-card footer',
  (role) => {
    const html = render(role)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
    expect(html).toContain('aria-label="Copy server ID"')
  },
)

test('cold navigation keeps disabled controls until permissions are resolved', () => {
  const html = render('owner', false)
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  expect(html).toContain('aria-label="Copy server ID"')
})

test('members retain the known ID copy control without editing actions', () => {
  const html = render('member')
  expect(html).toContain('aria-label="Copy server ID"')
  expect(html).not.toContain('>Save<')
  expect(html).not.toContain('>Cancel<')
})

test('cold navigation retains disabled danger actions while permissions resolve', () => {
  const html = render('owner', false)
  expect(html).toContain('id="danger"')
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*>.*?Disable server<\/button>/,
  )
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*>.*?Delete server<\/button>/,
  )
})

test.each(['owner', 'admin'] as const)(
  'pending %s danger actions are disabled',
  (role) => {
    const html = render(role)
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>.*?Disable server<\/button>/,
    )
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>.*?Delete server<\/button>/,
    )
  },
)

test('cached metric readings remain visible while chart history loads', () => {
  const html = render('owner', true, {
    ...server,
    monitoring: {
      ...server.monitoring,
      latestMetrics: {
        observedAt: '2026-10-07T12:00:00Z',
        cpuPercent: 12.5,
        load1: null,
        memoryUsedBytes: 1024,
        memoryTotalBytes: 2048,
        diskUsedBytes: 1024,
        diskTotalBytes: 2048,
        networkReceiveBytesPerSecond: null,
        networkTransmitBytesPerSecond: null,
        diskReadBytesPerSecond: null,
        diskWriteBytesPerSecond: null,
      },
    },
  })
  expect(html).toContain('12.5%')
  expect(html).toContain('1.0 KB / 2.0 KB')
  expect(html.match(/Loading data…/g)).toHaveLength(4)
  expect(html).not.toContain('<div data-slot="skeleton"')
})

test('known disabled server retains its disabled enable action', () => {
  const html = render('owner', true, { ...server, status: 'disabled' })
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Enable server<\/button>/)
  expect(html).not.toContain('Disable server')
})

test('resolved detail with no metrics renders the confirmed empty state', () => {
  const client = new QueryClient()

  client.setQueryData(['server-context', 'team', 'server-id'], {
    server: emptyDetail,
    team: projectContext.team,
  })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ServerDetailPending />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  expect(html).toContain('No metrics reported yet.')
  expect(html).not.toContain('Loading data…')
  client.clear()
})

test('connected shell with omitted monitoring keeps charts loading', () => {
  const html = render('owner', true, {
    ...server,
    status: 'connected',
    lastSeenAt: '2026-10-07T12:00:00Z',
  })
  expect(html.match(/Loading data…/g)).toHaveLength(4)
  expect(html).not.toContain('No metrics reported yet.')
})

test('cold → shell → detail never paints an empty metrics state', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const client = new QueryClient()
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const frames: Array<string> = []
  const observer = new MutationObserver(() => frames.push(node.textContent))
  observer.observe(node, {
    subtree: true,
    childList: true,
    characterData: true,
  })
  const paint = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <ServerDetailPending />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    )
  }
  try {
    await paint()
    expect(node.querySelectorAll('#metrics section')).toHaveLength(4)
    client.setQueryData(['team-context', 'team', 'shell'], {
      ...projectContext,
      projects: [],
      servers: [{ ...server, status: 'connected' }],
    })
    await paint()
    expect(node.querySelectorAll('#metrics [role="status"]')).toHaveLength(4)
    const sample = {
      observedAt: '2026-10-07T12:00:00Z',
      cpuPercent: 12.5,
      load1: null,
      memoryUsedBytes: 1024,
      memoryTotalBytes: 2048,
      diskUsedBytes: 1024,
      diskTotalBytes: 2048,
      networkReceiveBytesPerSecond: null,
      networkTransmitBytesPerSecond: null,
      diskReadBytesPerSecond: null,
      diskWriteBytesPerSecond: null,
    }
    client.setQueryData(['server-context', 'team', 'server-id'], {
      team: projectContext.team,
      server: {
        ...emptyDetail,
        status: 'connected',
        monitoring: { ...server.monitoring, latestMetrics: sample },
      },
    })
    await paint()
    expect(node.querySelectorAll('#metrics section')).toHaveLength(4)
    expect(node.querySelector('#metrics')?.textContent).toContain('12.5%')
    expect(frames.length).toBeGreaterThan(1)
    expect(
      frames.every((frame) => !frame.includes('No metrics reported yet.')),
    ).toBe(true)
  } finally {
    observer.disconnect()
    await act(async () => root.unmount())
    node.remove()
    client.clear()
    vi.unstubAllGlobals()
  }
})

test.each(['owner', 'member'] as const)(
  'agent update guidance respects %s permissions',
  (role) => {
    const client = new QueryClient()
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ServerDetailView
            server={{
              ...emptyDetail,
              agentUpdate: {
                status: 'required',
                latestVersion: '0.1.0',
                reason: 'Deployment protocol update required.',
              },
            }}
            team={{ ...projectContext.team, role }}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    if (role === 'member') {
      expect(html).toContain(
        'Contact a workspace owner or admin to update the agent.',
      )
      expect(html).not.toContain('sudo /usr/local/lib/devpush/update-agent')
    } else expect(html).toContain('sudo /usr/local/lib/devpush/update-agent')
    client.clear()
  },
)

test('the first hydration render ignores server metadata populated by a fast client loader', () => {
  hydration.ready = false
  try {
    const html = render('owner')
    expect(html).not.toContain('Test server')
    expect(html).not.toContain('Install agent')
    expect(html.match(/Loading data…/g)).toHaveLength(4)
    expect(html).toContain('value="server-id"')
  } finally {
    hydration.ready = true
  }
})
