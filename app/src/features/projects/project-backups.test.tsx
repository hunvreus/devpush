// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ProjectBackups } from './project-backups'
import { TooltipProvider } from '@/components/ui/tooltip'
import { projectContext } from '@/test/project-context'
import type { ProjectBackupConfig } from '@/server/projects/types'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  run: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/server/projects/functions', () => ({
  saveProjectBackupConfigs: mocks.save,
  runProjectBackup: mocks.run,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
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
            team: { ...context.team, role },
          }}
          filters={{}}
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
      .find((button) => button.textContent === label)!
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
  expect(
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.textContent === 'Pause')
      .every((button) => button.disabled),
  ).toBe(true)
  await click('Run', node)
  expect(mocks.run).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(mocks.error).toHaveBeenCalledWith('Unable to queue backup.')
  mocks.run.mockResolvedValueOnce(context)
  await click('Run', node)
  expect(mocks.run).toHaveBeenCalledTimes(2)
})
test('deletion requires confirmation and preserves failures inside the pending-locked dialog', async () => {
  let reject!: (error: Error) => void
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await click('Delete', node)
  expect(mocks.save).not.toHaveBeenCalled()
  await click('Delete policy', document.querySelector('[role="alertdialog"]')!)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => reject(new Error('HTTPError')))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to delete backup policy.',
  )
  mocks.save.mockResolvedValueOnce({
    ...context,
    backupConfigs: [context.backupConfigs[1]],
  })
  await click('Delete policy', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
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
  expect(node.textContent).toContain('Resume')
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
  ).toEqual(['Policies', 'Runs'])
  expect(node.textContent).not.toContain('Size')
  expect(node.textContent).not.toContain('1.5 KB')
  expect(node.textContent).toContain('1 volume · Server')
  expect(
    [...node.querySelectorAll('span')]
      .filter((span) => span.textContent === 'Production')
      .every((span) => span.closest('.text-muted-foreground')),
  ).toBe(true)
})

test('storage failures stay on the affected policy and expose local recovery', async () => {
  const failed = {
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
  expect(node.textContent).toContain('Local backup available for restoration.')
  expect(
    [...node.querySelectorAll('button')].some(
      (button) => button.textContent === 'Restore',
    ),
  ).toBe(true)
})

const restoreRun = {
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
    const statusCell = node.querySelector('[role="status"]')!
    expect(statusCell.getAttribute('aria-label')).toBe(`Restore ${status}`)
    expect(statusCell.className).not.toContain('col-span-full')
    expect(
      statusCell.parentElement?.querySelector('button')?.textContent,
    ).toContain('Restore')
    if (status === 'failed')
      expect(node.textContent).toContain('Archive checksum mismatch')
    const restore = [
      ...node.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Restore')!
    expect(restore.disabled).toBe(['queued', 'running'].includes(status))
  },
)
