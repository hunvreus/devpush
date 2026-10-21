// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ProjectBackups } from './project-backups'
import { TooltipProvider } from '@/components/ui/tooltip'
import { projectContext } from '@/test/project-context'
import type { BackupFilters } from './project-backup-utils'
import type { ProjectBackupConfig } from '@/server/projects/types'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  save: vi.fn(),
  run: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/server/projects/functions', () => ({
  saveProjectBackupPolicyAction: mocks.save,
  deleteProjectBackupPolicyAction: mocks.save,
  runProjectBackup: mocks.run,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  useRouter: () => ({ navigate: mocks.navigate }),
  Link: ({
    children,
    'aria-label': label,
    params,
    search,
    className,
  }: {
    children: ReactNode
    'aria-label'?: string
    params: Record<string, string>
    search?: Record<string, string | undefined>
    className?: string
  }) => (
    <a
      aria-label={label}
      className={className}
      href={`/${params.teamSlug}/projects/${params.projectName}/backups${params.backupId ? `/${params.backupId}` : ''}${search ? `?${new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => entry[1] !== undefined))}` : ''}`}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/lib/project-context-query', () => ({
  setProjectContextQueryData: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.error } }))
vi.mock('./project-heading', () => ({ ProjectHeading: () => null }))
vi.mock('./project-backup-policy', () => ({
  BackupPolicyDialog: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode
    disabled?: boolean
    onSelect: () => void
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}))
const backup: ProjectBackupConfig = {
  settingsVersion: 1,
  id: 'b',
  name: 'Nightly',
  environmentId: 'e',
  enabled: true,
  schedule: { cron: '0 2 * * *' },
  destination: {},
  retention: {
    local: { count: 7, days: 0, maxStorageGb: 0 },
    remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
  },
  volumes: { mode: 'none', names: [] },
  databaseDumps: [],
}
const context = {
  ...projectContext,
  backupConfigs: [backup, { ...backup, id: 'b2', name: 'Second' }],
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(
  role: 'owner' | 'member' = 'owner',
  runs: typeof projectContext.backupRuns = [],
  restores: typeof projectContext.backupRestores = [],
  configs = context.backupConfigs,
  filters: BackupFilters = {},
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
  })
  await act(async () =>
    root.render(
      <TooltipProvider>
        <ProjectBackups
          context={{
            ...context,
            backupRuns: runs,
            backupRestores: restores,
            backupConfigs: configs,
            team: { ...context.team, role },
          }}
          filters={filters}
        />
      </TooltipProvider>,
    ),
  )
  return node
}
test('members cannot run backups, configure policies or restore data', async () => {
  const node = await mount('member')
  expect(node.textContent).not.toContain('Run backup')
  expect(
    [...node.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Run',
    ),
  ).toHaveLength(0)
  for (const action of ['Create policy', 'Pause', 'Resume', 'Delete']) {
    expect(node.textContent).not.toContain(action)
  }
})
async function click(label: string, scope: ParentNode = document) {
  await act(async () =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')]
      .find(
        (button) =>
          button.textContent === label ||
          button.getAttribute('aria-label') === label ||
          (label === 'Run' && button.textContent === 'Run backup') ||
          (label === 'Pause' && button.id === 'policy-enabled-b'),
      )!
      .click(),
  )
}
test('running a backup locks other policy mutations and failed requests permit retry', async () => {
  let reject!: (error: Error) => void
  mocks.run.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await click('Run', node)
  expect(mocks.run).not.toHaveBeenCalled()
  await click('Run backup', document.querySelector('[role="alertdialog"]')!)
  expect(
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.getAttribute('role') === 'switch')
      .every((button) => button.disabled),
  ).toBe(true)
  await click('Run', node)
  expect(mocks.run).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to queue backup.'),
  )
  mocks.run.mockResolvedValueOnce(context)
  await click('Run backup', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.run).toHaveBeenCalledTimes(2)
})
test('policy actions show Run before the text-only activity and Settings menu', async () => {
  const node = await mount()
  const group = node.querySelector('[data-slot="button-group"]')!
  const run = group.querySelector('button')!
  expect(run.textContent).toBe('Run')
  expect(run.querySelector('svg')).toBeNull()
  expect(
    group.querySelector(
      '[aria-label="Actions for Nightly"] svg.lucide-ellipsis-vertical',
    ),
  ).not.toBeNull()
  const settings = [...group.querySelectorAll('a')].find(
    (link) => link.textContent === 'Settings',
  )!
  expect(settings.getAttribute('href')).toBe('/team/projects/project/backups/b')
  expect(settings.querySelector('svg')).toBeNull()
  expect(group.textContent).toContain('View activity')
  expect(group.textContent).not.toContain('Run backup')
  expect(node.textContent).not.toContain('Delete')
  expect(
    node.querySelector('#policy-enabled-b')?.getAttribute('aria-checked'),
  ).toBe('true')
})
test('pause failure keeps the previous policy state and success changes the available action', async () => {
  mocks.save.mockRejectedValueOnce(new Error('HTTPError'))
  const node = await mount()
  await click('Pause', node)
  expect(mocks.error).toHaveBeenCalledWith(
    'Unable to save backup policy. Please try again.',
  )
  mocks.save.mockResolvedValueOnce({
    ...context,
    backupConfigs: context.backupConfigs.map((item) => ({
      ...item,
      enabled: false,
    })),
  })
  await click('Pause', node)
  expect(
    node.querySelector('#policy-enabled-b')?.getAttribute('aria-checked'),
  ).toBe('false')
})

test('runs keep size in restore details and mute environment labels', async () => {
  const node = await mount('owner', [
    {
      id: 'run',
      status: 'succeeded',
      configId: 'b',
      localRecoveryAvailable: false,
      environmentId: 'e',
      environmentName: 'Production',
      environmentColor: 'lime',
      serverId: 's',
      serverName: 'Server',
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: '2026-10-07',
      artifacts: [
        {
          id: 'a',
          type: 'volume',
          storage: 'local',
          objectKey: 'volumes/data.tar.gz',
          checksumSha256: 'hash',
          sizeBytes: 1536,
          createdAt: '2026-10-07',
        },
      ],
    },
  ])
  expect(
    [...node.querySelectorAll('h2')].map((heading) => heading.textContent),
  ).toEqual(['Policies', 'Activity'])
  expect(node.textContent).not.toContain('Size')
  expect(node.textContent).not.toContain('1.5 KB')
  expect(node.querySelector('[aria-label="1 volume"]')).toBeNull()
  expect(node.querySelector('.lucide-hard-drive')).toBeNull()
  expect(node.querySelector('.lucide-database')).toBeNull()
  expect(node.querySelector('.lucide-cloud')).toBeNull()
  expect(node.textContent).not.toContain('saved on server')
  expect(
    [...node.querySelectorAll('span')]
      .filter((span) => span.textContent === 'Production')
      .every((span) => span.closest('.text-muted-foreground')),
  ).toBe(true)
})

test('storage failures stay on the affected policy and expose local recovery', async () => {
  const failed = {
    settingsVersion: 1,
    id: 'failed-upload',
    configId: 'b2',
    status: 'failed' as const,
    localRecoveryAvailable: true,
    environmentId: 'e',
    environmentName: 'Production',
    environmentColor: 'lime',
    serverId: 's',
    serverName: 'Server',
    errorMessage: 'Remote upload failed. Bucket unavailable.',
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-08',
    artifacts: [
      {
        settingsVersion: 1,
        id: 'local',
        type: 'volume' as const,
        storage: 'local' as const,
        objectKey: '/backup/data.tar.gz',
        checksumSha256: 'a'.repeat(64),
        sizeBytes: 12,
        createdAt: '2026-10-08',
      },
    ],
  }
  const node = await mount('owner', [failed])
  const policies = node.querySelectorAll('li')
  expect(policies[0]?.querySelector('[role="alert"]')).toBeNull()
  expect(policies[1]?.querySelector('[role="alert"]')?.textContent).toContain(
    'Remote upload failed; local backup available',
  )
  expect(node.querySelector('[data-backup-activity] [role="alert"]')).toBeNull()
  expect(
    [...node.querySelectorAll('button')].some(
      (button) => button.getAttribute('aria-label') === 'Restore',
    ),
  ).toBe(true)
})

const restoreRun = {
  settingsVersion: 1,
  id: 'restore-source',
  configId: 'b',
  localRecoveryAvailable: false,
  status: 'succeeded' as const,
  environmentId: 'e',
  environmentName: 'Production',
  environmentColor: 'lime',
  serverId: 's',
  serverName: 'Server',
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-10-09T00:00:00Z',
  artifacts: [
    {
      settingsVersion: 1,
      id: 'a',
      type: 'volume' as const,
      storage: 'local' as const,
      objectKey: '/backup/data.tar.gz',
      checksumSha256: 'checksum',
      sizeBytes: 10,
      createdAt: '2026-10-09T00:00:00Z',
    },
  ],
}
test.each(['queued', 'running', 'succeeded', 'failed'] as const)(
  'shows %s restore status and failure details; locks active restores',
  async (status) => {
    const node = await mount(
      'owner',
      [restoreRun],
      [
        {
          id: 'r',
          backupRunId: restoreRun.id,
          environmentId: 'e',
          status,
          errorMessage:
            status === 'failed' ? 'Archive checksum mismatch' : null,
          createdAt: restoreRun.createdAt,
          startedAt: null,
          finishedAt: null,
        },
      ],
    )
    const statusCell = node.querySelector(
      '[data-backup-activity="restore"] [role="status"]',
    )!
    expect(statusCell.getAttribute('aria-label')).toBe(`Restore ${status}`)
    expect(statusCell.textContent).toBe('')
    expect(
      statusCell.closest('[data-backup-activity]')?.firstElementChild,
    ).toBe(statusCell)
    expect(
      node
        .querySelector(
          '[data-backup-activity="restore"] [data-variant="secondary"]',
        )
        ?.getAttribute('data-variant'),
    ).toBe('secondary')
    expect(
      node
        .querySelector(
          '[data-backup-activity="backup"] [data-variant="secondary"]',
        )
        ?.getAttribute('data-variant'),
    ).toBe('secondary')
    expect(statusCell.className).not.toContain('col-span-full')
    expect(node.querySelectorAll('[data-backup-activity]')).toHaveLength(2)
    const row = statusCell.closest('[data-backup-activity]')!
    const policy = row.querySelector('a')!
    expect(policy.textContent).toBe('Nightly')
    expect(policy.getAttribute('href')).toBe(
      '/team/projects/project/backups?policy=b',
    )
    expect(policy.nextElementSibling?.tagName).toBe('TIME')
    expect(policy.className).not.toContain('underline')
    expect(row.tagName).toBe('LI')
    const actions = row.querySelector('[data-slot="button-group"]')!
    const menu = actions.querySelector('button[aria-label="Restore actions"]')!
    expect(menu.querySelector('svg.lucide-ellipsis-vertical')).not.toBeNull()
    const logs = [...actions.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore logs',
    )!
    expect(logs.querySelector('svg')).toBeNull()
    const details = [...actions.querySelectorAll('button')].find(
      (button) => button.textContent === 'Details',
    )!
    expect(details).toBeDefined()
    expect(row.querySelector('.font-mono')?.textContent).toBe('r')
    expect(row.querySelector('.font-mono')?.className).toContain('font-medium')
    expect(policy.className).toContain('text-muted-foreground')
    expect(policy.className).not.toContain('font-medium')
    expect(row.textContent).not.toContain('View error')
    expect(row.querySelector('svg.lucide-undo-2')).not.toBeNull()
    expect(
      node.querySelector(
        '[data-backup-activity="backup"] svg.lucide-arrow-down',
      ),
    ).not.toBeNull()
    const restore = [
      ...node.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.getAttribute('aria-label') === 'Restore')!
    expect(restore.disabled).toBe(['queued', 'running'].includes(status))
  },
)

test('history remains visible when policies are removed', async () => {
  const node = await mount('member', [restoreRun], [], [])
  expect(node.textContent).toContain('No backup policies yet.')
  expect(node.querySelector('[data-backup-activity="backup"]')).not.toBeNull()
  expect(node.querySelector('[aria-label="Restore"]')).toBeNull()
})

test('activity keeps environment filtering and drops server metadata', async () => {
  const node = await mount('owner', [restoreRun])
  const row = node.querySelector('[data-backup-activity="backup"]')!
  const environment = row.querySelector<HTMLAnchorElement>(
    'a[aria-label="Filter history by environment"]',
  )!
  expect(environment.getAttribute('href')).toBe(
    '/team/projects/project/backups?environment=e',
  )
  expect(environment.textContent).toBe('Production')
  expect(environment.className).not.toContain('underline')
  expect(
    row.querySelector('[aria-label="Filter history by server"]'),
  ).toBeNull()
  expect(row.querySelector('.font-mono')?.textContent).toBe('restore')
  expect(
    [...row.querySelectorAll('button')].some(
      (button) => button.textContent === 'Backup logs',
    ),
  ).toBe(true)
  expect(
    row.querySelector(
      '[aria-label="Backup actions"] svg.lucide-ellipsis-vertical',
    ),
  ).not.toBeNull()
})

test('active activity filters offer reset and natural-width controls', async () => {
  const node = await mount('owner', [restoreRun], [], context.backupConfigs, {
    status: 'succeeded',
  })
  const reset = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Reset filters',
  )!
  expect(reset).toBeDefined()
  expect(
    [...node.querySelectorAll('[data-slot="select-trigger"]')].every(
      (trigger) => !/w-(36|44)/.test(trigger.className),
    ),
  ).toBe(true)
  await act(async () => reset.click())
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/$teamSlug/projects/$projectName/backups',
    params: { teamSlug: 'team', projectName: 'project' },
    search: {},
  })
})

test('policy View activity links filter activity and remain available to members', async () => {
  const node = await mount('member', [restoreRun])
  const link = [...node.querySelectorAll<HTMLAnchorElement>('a')].find(
    (item) => item.textContent === 'View activity',
  )!
  expect(link.getAttribute('href')).toBe(
    '/team/projects/project/backups?policy=b',
  )
  expect(node.textContent).not.toContain('RunNightly')
})

test('policy filter includes the selected policy backup and restore only', async () => {
  const other = { ...restoreRun, id: 'other', configId: 'other-policy' }
  const node = await mount(
    'member',
    [restoreRun, other],
    [
      {
        id: 'r',
        backupRunId: restoreRun.id,
        environmentId: 'e',
        status: 'succeeded',
        createdAt: restoreRun.createdAt,
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
      },
    ],
    context.backupConfigs,
    { policy: 'b' },
  )
  expect(node.querySelectorAll('[data-backup-activity]')).toHaveLength(2)
})

test('Latest marks the newest attempt per policy and does not move to an older filtered result', async () => {
  const newest = {
    ...restoreRun,
    settingsVersion: 1,
    id: 'newest',
    status: 'failed' as const,
    createdAt: '2026-10-10T00:00:00Z',
  }
  const second = { ...restoreRun, id: 'second', configId: 'b2' }
  const node = await mount('member', [restoreRun, second, newest])
  const rows = [...node.querySelectorAll('[data-backup-activity]')]
  expect(rows.map((row) => row.textContent.includes('Latest'))).toEqual([
    true,
    false,
    true,
  ])
  const filtered = await mount(
    'member',
    [restoreRun, newest],
    [],
    context.backupConfigs,
    { status: 'succeeded' },
  )
  expect(
    filtered.querySelector('[data-backup-activity]')?.textContent,
  ).not.toContain('Latest')
})

test('Latest follows metadata immediately before the action group', async () => {
  const node = await mount('member', [restoreRun])
  const row = node.querySelector('[data-backup-activity]')!
  const badge = [...row.querySelectorAll('span')].find(
    (item) => item.textContent === 'Latest',
  )!
  expect(
    badge.nextElementSibling?.querySelector('[aria-label="Operation actions"]'),
  ).not.toBeNull()
})
