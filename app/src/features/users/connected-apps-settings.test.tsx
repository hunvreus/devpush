// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { scopesForApiPreset } from '#devpush/lib/api-key-schema'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { ConnectedAppsSettings } from './connected-apps-settings'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }))
vi.mock('#devpush/server/mcp/functions', () => ({
  getMcpConnectionsAction: mocks.list,
  revokeMcpConnectionAction: mocks.revoke,
}))
vi.mock('#devpush/lib/action-feedback', () => ({
  mutationErrorOptions: () => [],
  afterMutation: async (task: () => Promise<unknown>) => task(),
}))
const cleanup: Array<() => Promise<void>> = []
const connection = {
  id: 'g',
  name: 'Test assistant',
  team: {
    id: 'team',
    name: 'Team',
    image: '/team.png',
    color: 'blue' as const,
  },
  projects: null,
  scopes: scopesForApiPreset('read', 'member'),
  status: 'active',
  createdAt: '2026-10-13T00:00:00.000Z',
  expiresAt: '2026-11-13T00:00:00.000Z',
  lastUsedAt: null,
}
const project = {
  id: 'one-project',
  name: 'Browser smoke',
  image: '/project.png',
  color: 'green' as const,
  available: true,
}

async function renderSettings(existingClient?: QueryClient) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const client =
    existingClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  cleanup.push(async () => {
    await act(async () => root.unmount())
    client.clear()
    node.remove()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ConnectedAppsSettings userId="u" />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  )
  return node
}

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
test('connection revocation asks for confirmation and failed requests expose no diagnostics', async () => {
  mocks.list.mockResolvedValue({
    mcpUrl: 'https://devpush.example/mcp',
    connections: [connection],
    pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
  })
  mocks.revoke.mockRejectedValueOnce(new Error('provider private diagnostic'))
  await renderSettings()
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('Test assistant'),
  )
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label^="Revoke "]')!
      .click(),
  )
  expect(document.body.textContent).toContain('https://devpush.example/mcp')
  expect(mocks.revoke).not.toHaveBeenCalled()
  await act(async () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ]
      .find((button) => button.textContent === 'Revoke')!
      .click(),
  )
  expect(mocks.revoke).toHaveBeenCalledWith({ data: { id: 'g' } })
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to revoke this connection.'),
  )
  expect(document.body.textContent).not.toContain('provider private diagnostic')
})

test.each([
  { preset: 'read', role: 'member', logs: false, label: 'Read only' },
  { preset: 'deploy', role: 'member', logs: true, label: 'Deploy' },
  { preset: 'manage', role: 'admin', logs: false, label: 'Manage' },
  { preset: 'manage', role: 'member', logs: true, label: 'Manage' },
] as const)(
  '$preset connection shows granted access for $role, expiry and named project scope',
  async ({ preset, role, logs, label }) => {
    mocks.list.mockResolvedValue({
      mcpUrl: 'https://devpush.example/mcp',
      connections: [
        {
          ...connection,
          projects: [project],
          scopes: scopesForApiPreset(preset, role, logs),
        },
      ],
      pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
    })
    const node = await renderSettings()
    await vi.waitFor(() =>
      expect(node.querySelector('tbody tr')?.textContent).toContain(
        connection.name,
      ),
    )
    const row = node.querySelector('tbody tr')!
    const cells = row.querySelectorAll('td')
    expect(cells).toHaveLength(6)
    const statusCell = cells.item(0)
    const appCell = cells.item(1)
    const scopeCell = cells.item(2)
    const accessCell = cells.item(3)
    expect(appCell.textContent).toContain(connection.name)
    expect(appCell.textContent).not.toContain('active')
    expect(appCell.querySelector('svg')).toBeNull()
    expect(statusCell.textContent).toContain('Active')
    expect(scopeCell.textContent).toContain(project.name)
    expect(
      scopeCell.querySelector(
        '[data-slot="tooltip-trigger"][role="img"][aria-label="Team"]',
      ),
    ).not.toBeNull()
    expect(
      scopeCell.querySelector('img[alt="Team"]')?.getAttribute('src'),
    ).toBe('/team.png')
    expect(
      scopeCell.querySelector('img[alt="Browser smoke"]')?.getAttribute('src'),
    ).toBe('/project.png')
    expect(
      scopeCell.querySelector('img[alt="Team"]')?.classList.contains('size-5'),
    ).toBe(true)
    expect(
      scopeCell
        .querySelector('img[alt="Browser smoke"]')
        ?.classList.contains('size-5'),
    ).toBe(true)
    expect(scopeCell.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    expect(scopeCell.textContent).not.toContain('1 project')
    expect(accessCell.textContent).toContain(label)
    expect(accessCell.textContent.includes('Includes logs')).toBe(logs)
    expect(row.textContent).not.toContain('projects:read')
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe(
      connection.expiresAt,
    )
    expect(row.querySelector('time')?.textContent).toContain('2026')
    expect(node.querySelector('code')?.textContent).toBe(
      'https://devpush.example/mcp',
    )
  },
)

test('populated apps use labelled compact table columns and a horizontal scroll boundary', async () => {
  const name =
    'An assistant with a long client name that still needs to remain identifiable'
  mocks.list.mockResolvedValue({
    mcpUrl: 'https://devpush.example/mcp',
    connections: [{ ...connection, name, status: 'revoked' }],
    pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
  })
  const node = await renderSettings()
  await vi.waitFor(() =>
    expect(node.querySelector('tbody tr')?.textContent).toContain(name),
  )
  const table = node.querySelector('table[aria-label="Connected apps"]')!
  const headings = [...table.querySelectorAll('thead th')]
  expect(headings.map((heading) => heading.textContent)).toEqual([
    'Status',
    'App',
    'Scope',
    'Access',
    'Expires',
    'Actions',
  ])
  expect(
    headings.every((heading) => heading.getAttribute('scope') === 'col'),
  ).toBe(true)
  expect(
    table
      .closest('[data-slot="table-container"]')
      ?.classList.contains('overflow-x-auto'),
  ).toBe(true)
  expect(table.className).toContain('min-w-')
  expect(headings[0]?.classList.contains('pl-4')).toBe(true)
  expect(table.querySelector('tbody td')?.classList.contains('pl-4')).toBe(true)
  expect(headings.at(-1)?.querySelector('.sr-only')?.textContent).toBe(
    'Actions',
  )
  expect(table.querySelector('tbody td')?.querySelector('svg')).toBeNull()
  expect(table.querySelector('p[title]')?.getAttribute('title')).toBe(name)
  expect(table.querySelector('p[title]')?.classList.contains('truncate')).toBe(
    true,
  )
  expect(table.querySelector('tbody tr')?.textContent).toContain('All projects')
  expect(table.textContent).not.toMatch(/last used|last active/i)
  expect(table.querySelector('button')?.disabled).toBe(true)
  expect(table.querySelector('button')?.getAttribute('aria-label')).toBe(
    `Revoke ${name}`,
  )
})

test.each([
  { status: 'active', label: 'Active', variant: 'secondary', muted: false },
  { status: 'revoked', label: 'Revoked', variant: 'destructive', muted: false },
  { status: 'expired', label: 'Expired', variant: 'secondary', muted: true },
  {
    status: 'unavailable',
    label: 'Unavailable',
    variant: 'outline',
    muted: true,
  },
])(
  '$status has a separate $variant status badge',
  async ({ status, label, variant, muted }) => {
    mocks.list.mockResolvedValue({
      mcpUrl: 'https://devpush.example/mcp',
      connections: [{ ...connection, status }],
      pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
    })
    const node = await renderSettings()
    await vi.waitFor(() =>
      expect(node.querySelector('tbody tr')?.textContent).toContain(
        connection.name,
      ),
    )
    const row = node.querySelector('tbody tr')!
    const cells = row.querySelectorAll('td')
    expect(cells.item(1).textContent).toBe(connection.name)
    const badge = cells.item(0).querySelector('[data-slot="badge"]')!
    expect(badge.textContent).toBe(label)
    expect(badge.getAttribute('data-variant')).toBe(variant)
    expect(badge.classList.contains('text-muted-foreground')).toBe(muted)
  },
)

test('multi-project scope uses selected project avatars and accessible full names', async () => {
  const projects = [
    project,
    { ...project, id: 'two', name: 'API sandbox', image: '/api.png' },
    { ...project, id: 'three', name: 'Archive preview', image: '/archive.png' },
    { ...project, id: 'four', name: 'Extra project', image: '/extra.png' },
  ]
  mocks.list.mockResolvedValue({
    mcpUrl: 'https://devpush.example/mcp',
    connections: [{ ...connection, projects }],
    pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
  })
  const node = await renderSettings()
  await vi.waitFor(() =>
    expect(node.querySelector('tbody tr')?.textContent).toContain(
      connection.name,
    ),
  )
  const scope = node.querySelectorAll('tbody td').item(2)
  expect(scope.textContent).toContain('4 projects')
  for (const selected of projects.slice(0, 3)) {
    const avatar = [...scope.querySelectorAll('img')].find(
      (image) => image.alt === selected.name,
    )!
    expect(avatar.getAttribute('src')).toBe(selected.image)
    expect(avatar.classList.contains('size-5')).toBe(true)
  }
  expect(scope.querySelector('img[alt="Extra project"]')).toBeNull()
  const trigger = [...scope.querySelectorAll('[aria-label]')].find((element) =>
    projects.every(({ name }) =>
      element.getAttribute('aria-label')?.includes(name),
    ),
  )
  expect(trigger).toBeDefined()
})

test('a missing selected project stays visibly unavailable without exposing its ID', async () => {
  mocks.list.mockResolvedValue({
    mcpUrl: 'https://devpush.example/mcp',
    connections: [
      {
        ...connection,
        status: 'unavailable',
        projects: [
          {
            id: 'missing-project-id',
            name: null,
            image: null,
            color: 'zinc',
            available: false,
          },
        ],
      },
    ],
    pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
  })
  const node = await renderSettings()
  await vi.waitFor(() =>
    expect(node.querySelector('tbody tr')?.textContent).toContain(
      connection.name,
    ),
  )
  const scope = node.querySelectorAll('tbody td').item(2)
  expect(scope.textContent).toContain('Unavailable project')
  expect(scope.textContent).not.toContain('missing-project-id')
  expect(scope.textContent).not.toContain('All projects')
})

test('successful revocation closes the confirmation and refreshes the actual app status', async () => {
  const data = {
    mcpUrl: 'https://devpush.example/mcp',
    connections: [connection],
    pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
  }
  mocks.list.mockResolvedValueOnce(data).mockResolvedValue({
    ...data,
    connections: [{ ...connection, status: 'revoked' }],
  })
  mocks.revoke.mockResolvedValue({})
  const node = await renderSettings()
  await vi.waitFor(() =>
    expect(node.querySelector('tbody tr')?.textContent).toContain(
      connection.name,
    ),
  )
  await act(async () =>
    node.querySelector<HTMLButtonElement>('tbody button')!.click(),
  )
  expect(mocks.revoke).not.toHaveBeenCalled()
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="alertdialog"] button',
    ),
  ].find((button) => button.textContent === 'Revoke')!
  await act(async () => confirm.click())
  await vi.waitFor(() =>
    expect(
      node.querySelector<HTMLButtonElement>('tbody button')?.disabled,
    ).toBe(true),
  )
  expect(mocks.revoke).toHaveBeenCalledWith({ data: { id: 'g' } })
  expect(mocks.list).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(node.querySelector('tbody tr')?.textContent).toContain('Revoked')
})

test('pagination loads the requested account connection page', async () => {
  mocks.list.mockImplementation(({ data }: { data: { page: number } }) =>
    Promise.resolve({
      mcpUrl: 'https://devpush.example/mcp',
      connections: [{ ...connection, name: `Assistant page ${data.page}` }],
      pagination: { page: data.page, totalPages: 2, total: 26, pageSize: 25 },
    }),
  )
  const node = await renderSettings()
  await vi.waitFor(() => expect(node.textContent).toContain('Assistant page 1'))
  const findButton = (text: string) =>
    [...node.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === text,
    )!
  expect(findButton('Previous').disabled).toBe(true)
  await act(async () => findButton('Next').click())
  await vi.waitFor(() => expect(node.textContent).toContain('Assistant page 2'))
  expect(mocks.list).toHaveBeenLastCalledWith({ data: { page: 2 } })
  expect(node.textContent).toContain('Page 2 of 2')
  expect(findButton('Previous').disabled).toBe(false)
  expect(findButton('Next').disabled).toBe(true)
})

test('pending apps keep table labels and a disabled revoke control visible', async () => {
  mocks.list.mockReturnValue(new Promise(() => {}))
  const node = await renderSettings()
  const pending = node.querySelector(
    '[role="status"][aria-label="Connected apps loading"]',
  )!
  expect(
    [...pending.querySelectorAll('thead th')].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(['Status', 'App', 'Scope', 'Access', 'Expires', 'Actions'])
  expect(
    pending.querySelector('tbody tr')?.querySelectorAll('td'),
  ).toHaveLength(6)
  expect(pending.querySelector('svg.lucide-app-window')).toBeNull()
  expect(pending.querySelector('button')?.disabled).toBe(true)
  expect(pending.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Revoke access',
  )
  const header = node.querySelector('[data-slot="card-header"]')!
  expect(
    header.querySelector('[role="status"][aria-label="MCP URL loading"]'),
  ).not.toBeNull()
  expect(
    header.querySelector<HTMLButtonElement>('button[aria-label="Copy MCP URL"]')
      ?.disabled,
  ).toBe(true)
  expect(node.querySelector('code')).toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('empty accounts show management copy without exposing setup in the body', async () => {
  mocks.list.mockResolvedValue({
    mcpUrl: 'https://devpush.example/mcp',
    connections: [],
    pagination: { page: 1, totalPages: 1, total: 0, pageSize: 25 },
  })
  const node = await renderSettings()
  await vi.waitFor(() =>
    expect(node.textContent).toContain('No connected apps.'),
  )
  expect(node.querySelector('table')).toBeNull()
  expect(node.textContent).toContain('Apps you authorize will appear here.')
  expect(node.querySelector('code')?.textContent).toBe(
    'https://devpush.example/mcp',
  )
  expect(node.querySelector('button[aria-label="Copy MCP URL"]')).not.toBeNull()
})

test.each([false, true])(
  'the header shows one copyable MCP URL with populated=%s',
  async (populated) => {
    mocks.list.mockResolvedValue({
      mcpUrl: 'https://devpush.example/mcp',
      connections: populated ? [connection] : [],
      pagination: {
        page: 1,
        totalPages: 1,
        total: populated ? 1 : 0,
        pageSize: 25,
      },
    })
    const node = await renderSettings()
    await vi.waitFor(() =>
      expect(node.querySelector('code')?.textContent).toBe(
        'https://devpush.example/mcp',
      ),
    )
    const header = node.querySelector('[data-slot="card-header"]')!
    const description = header.querySelector('[data-slot="card-description"]')!
    expect(description.textContent).toBe(
      'Connect apps with browser sign-in or an API key using this MCP URL; https://devpush.example/mcp',
    )
    const button = description.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy MCP URL"]',
    )!
    expect(button.disabled).toBe(false)
    expect(button.querySelector('code')?.textContent).toBe(
      'https://devpush.example/mcp',
    )
    expect(button.querySelector('svg')).not.toBeNull()
    expect(node.querySelectorAll('code')).toHaveLength(1)
    expect(node.querySelector('[data-slot="card-content"] code')).toBeNull()
    expect(header.querySelector('[data-slot="card-action"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(
      [...node.querySelectorAll('button')].filter(
        (control) => control.textContent === 'Connect app',
      ),
    ).toHaveLength(0)
  },
)

test.each([
  {
    target: 'URL text',
    succeeds: true,
    feedback: 'Copied',
    icon: 'lucide-check',
  },
  {
    target: 'copy icon',
    succeeds: false,
    feedback: 'Unable to copy',
    icon: 'lucide-copy',
  },
])(
  'clicking $target copies the complete long URL through its single button and reports $feedback',
  async ({ target, succeeds, feedback, icon }) => {
    const url =
      'https://mcp.organization-organization-organization-test.region-region-region-region-example.devpush.example/mcp'
    const writeText = succeeds
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('private clipboard error'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mocks.list.mockResolvedValue({
      mcpUrl: url,
      connections: [],
      pagination: { page: 1, totalPages: 1, total: 0, pageSize: 25 },
    })
    const node = await renderSettings()
    await vi.waitFor(() =>
      expect(node.querySelector('code')?.textContent).toBe(url),
    )
    const button = node.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy MCP URL"]',
    )!
    const code = button.querySelector('code')!
    const svg = button.querySelector('svg')!
    expect(code.closest('button')).toBe(button)
    expect(svg.closest('button')).toBe(button)
    expect(button.querySelectorAll('code')).toHaveLength(1)
    expect(node.querySelectorAll('button')).toHaveLength(1)
    expect(code.classList.contains('truncate')).toBe(false)
    await act(async () => {
      if (target === 'URL text') code.click()
      else svg.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(url)
    expect(button.getAttribute('aria-label')).toBe(feedback)
    expect(button.querySelector(`svg.${icon}`)).not.toBeNull()
    expect(code.textContent).toBe(url)
    expect(node.textContent).not.toContain('private clipboard error')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  },
)

test('cached header URL stays copyable after a background error and follows the current canonical URL', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const queryKey = ['account-connected-apps', 'u', 1]
  const data = {
    mcpUrl: 'https://old.devpush.example/mcp',
    connections: [connection],
    pagination: { page: 1, totalPages: 1, total: 1, pageSize: 25 },
  }
  client.setQueryData(queryKey, data)
  mocks.list.mockRejectedValue(new Error('private backend error'))
  const node = await renderSettings(client)
  await act(async () => {
    await client.refetchQueries({ queryKey })
  })
  await vi.waitFor(() =>
    expect(node.textContent).toContain('Unable to load connected apps.'),
  )
  expect(node.textContent).not.toContain('private backend error')
  const copy = node.querySelector<HTMLButtonElement>(
    '[data-slot="card-header"] button[aria-label="Copy MCP URL"]',
  )!
  expect(copy.disabled).toBe(false)
  expect(copy.querySelector('code')?.textContent).toBe(data.mcpUrl)
  await act(async () => {
    client.setQueryData(queryKey, {
      ...data,
      mcpUrl: 'https://current.devpush.example/mcp',
    })
  })
  await vi.waitFor(() =>
    expect(copy.querySelector('code')?.textContent).toBe(
      'https://current.devpush.example/mcp',
    ),
  )
  expect(node.querySelectorAll('code')).toHaveLength(1)
  expect(node.textContent).not.toContain(data.mcpUrl)
  await act(async () => copy.click())
  expect(writeText).toHaveBeenCalledWith('https://current.devpush.example/mcp')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
