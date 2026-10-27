// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import {
  BackupRunRestoreActions,
  BackupRestoreDetails,
} from './backup-restore-actions'
import type {
  ProjectBackupArtifact,
  ProjectBackupRun,
} from '#devpush/server/projects/types'

const artifact: ProjectBackupArtifact = {
  id: 'a',
  type: 'database',
  storage: 'local',
  objectKey: 'databases/01-postgres.sql.gz',
  checksumSha256: 'hash',
  sizeBytes: 10,
  createdAt: '2026-10-04',
}
const run: ProjectBackupRun = {
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
  createdAt: '2026-10-04',
  databaseTargets: [{ service: 'postgres', engine: 'postgres', database: '' }],
  artifacts: [artifact],
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
type Restore = ComponentProps<typeof BackupRunRestoreActions>['onRestore']
async function mount(
  onRestore: Restore,
  source = artifact,
  _volumes: Array<string> = [],
  targetServerName = 'Server',
  otherArtifacts: ProjectBackupArtifact[] = [],
) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
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
        <BackupRunRestoreActions
          policyName="Production backup"
          projectId="p"
          targetServerName={targetServerName}
          targetServerStatus="connected"
          artifacts={[source, ...otherArtifacts]}
          disabled={false}
          restoringRunId={null}
          run={run}
          onRestore={onRestore}
        />
      </TooltipProvider>,
    ),
  )
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === 'Restore')!
      .click(),
  )
}
async function queue() {
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(
        (button) =>
          button.textContent === 'Restore' &&
          button.getAttribute('form') === 'backup-restore-form',
      )!
      .click(),
  )
}
test('restore waits for acknowledgement, preserves a failed form and allows retry', async () => {
  let reject!: (error: Error) => void
  const restore = vi.fn<Restore>().mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await mount(restore)
  await queue()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.querySelector('fieldset')?.disabled).toBe(true)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await queue()
  expect(restore).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to queue restore.',
  )
  restore.mockResolvedValueOnce(undefined)
  await queue()
  expect(restore).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
test('database restoration uses immutable engine settings, without an editable command', async () => {
  const restore = vi.fn<Restore>().mockResolvedValue(undefined)
  await mount(restore)
  expect(document.querySelector('#restore-command')).toBeNull()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'PostgreSQL',
  )
  await queue()
  expect(restore.mock.calls[0]?.[0]).not.toHaveProperty('restoreCommand')
})

const volume: ProjectBackupArtifact = {
  ...artifact,
  id: 'volume',
  type: 'volume',
  objectKey: 'volumes/dp_p000000000_e000000000_test_data.tar.gz',
}

test('selects all contents and submits volumes and databases in one restore', async () => {
  const restore = vi.fn<Restore>().mockResolvedValue(undefined)
  await mount(restore, artifact, [], 'Current server', [volume])
  const dialog = document.querySelector('[role="dialog"]')!
  const checkboxes = [...dialog.querySelectorAll('[role="checkbox"]')]
  expect(checkboxes).toHaveLength(2)
  expect(
    checkboxes.every((item) => item.getAttribute('aria-checked') === 'true'),
  ).toBe(true)
  expect(dialog.textContent).toContain('Production')
  expect(dialog.textContent).toContain('Current server')
  expect(
    dialog.querySelector('svg.lucide-server')?.parentElement?.className,
  ).toContain('text-success')
  expect(dialog.textContent).toContain('Production backup')
  expect(dialog.querySelector('time')?.dateTime).toBe(run.createdAt)
  expect(
    [...dialog.querySelectorAll('dt')].map((el) => el.textContent),
  ).toEqual(['Created', 'Policy', 'Environment', 'Server'])
  expect(
    dialog.querySelector('[data-slot=dialog-description]')?.textContent,
  ).toContain('Selected data will be replaced.')
  expect(dialog.textContent).toContain('test_data')
  expect(dialog.textContent).toContain('10 B')
  expect(
    [...dialog.querySelectorAll('h3')].map((el) => el.textContent),
  ).toEqual(['Backup', 'Volumes', 'Databases'])
  expect(dialog.textContent).not.toContain('Source')
  expect(dialog.textContent).not.toContain('.tar.gz')
  expect(dialog.querySelector('[role="combobox"]')).toBeNull()
  await queue()
  expect(restore).toHaveBeenCalledExactlyOnceWith({
    run,
    artifacts: [
      { artifactId: 'a', type: 'database', targetService: 'postgres' },
      { artifactId: 'volume', type: 'volume', targetVolume: 'test_data' },
    ],
  })
})

test('deduplicates server and remote copies and prefers the server copy regardless of order', async () => {
  const restore = vi.fn<Restore>().mockResolvedValue(undefined)
  const remote = {
    ...volume,
    id: 'remote',
    storage: 'remote' as const,
    objectKey: 'remote/' + volume.objectKey,
  }
  await mount(restore, remote, [], 'Server', [volume])
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(1)
  await queue()
  expect(restore.mock.calls[0]![0].artifacts).toEqual([
    { artifactId: 'volume', type: 'volume', targetVolume: 'test_data' },
  ])
})

test('uses remote-only contents without exposing file or storage selection', async () => {
  const restore = vi.fn<Restore>().mockResolvedValue(undefined)
  const remote = {
    ...artifact,
    id: 'remote',
    storage: 'remote' as const,
    objectKey: 'remote/' + artifact.objectKey,
  }
  await mount(restore, remote)
  await queue()
  expect(restore.mock.calls[0]![0].artifacts).toEqual([
    { artifactId: 'remote', type: 'database', targetService: 'postgres' },
  ])
})

test('allows a subset and disables restoration when nothing is selected', async () => {
  const restore = vi.fn<Restore>().mockResolvedValue(undefined)
  await mount(restore, artifact, [], 'Server', [volume])
  const checkboxes = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
  ]
  await act(async () => checkboxes[0]!.click())
  await act(async () => checkboxes[1]!.click())
  expect(
    document.querySelector<HTMLButtonElement>(
      'button[form="backup-restore-form"]',
    )!.disabled,
  ).toBe(true)
  expect(restore).not.toHaveBeenCalled()
  await act(async () => checkboxes[0]!.click())
  await queue()
  expect(restore.mock.calls[0]![0].artifacts).toEqual([
    { artifactId: 'volume', type: 'volume', targetVolume: 'test_data' },
  ])
})

test.each(['succeeded', 'failed'] as const)(
  'restore details show %s status and readonly contents',
  async (status) => {
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
          <BackupRestoreDetails
            projectId="p"
            policyName="Production backup"
            onClose={() => {}}
            serverStatus="disconnected"
            run={{ ...run, artifacts: [artifact, volume] }}
            restore={{
              id: 'restore',
              backupRunId: run.id,
              environmentId: 'e',
              status,
              errorMessage: status === 'failed' ? 'Checksum mismatch' : null,
              createdAt: run.createdAt,
              startedAt: null,
              finishedAt: null,
              artifacts: [
                {
                  artifactId: 'volume',
                  type: 'volume',
                  targetVolume: 'dp_p000000000_e000000000_test_data',
                },
              ],
            }}
          />
        </TooltipProvider>,
      ),
    )
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Production backup')
    expect(dialog.textContent).toContain('test_data')
    expect(
      dialog.querySelector('[aria-label="Restored contents"]')?.textContent,
    ).not.toContain('dp_p000000000_e000000000_')
    expect(dialog.textContent).not.toContain('postgres')
    expect(dialog.querySelector('[role="checkbox"]')).toBeNull()
    expect(
      [...dialog.querySelectorAll('dt')].map((el) => el.textContent),
    ).toEqual([
      'Started',
      'Status',
      ...(status === 'failed' ? ['Message'] : []),
      'Created',
      'Policy',
      'Environment',
      'Server',
    ])
    expect(dialog.textContent).toContain('10 B')
    expect(
      [...dialog.querySelectorAll('h3')].map((el) => el.textContent),
    ).toEqual(['Restore', 'Backup', 'Volumes', 'Databases'])
    expect(dialog.textContent).toContain('Not recorded')
    expect(
      dialog.querySelector('svg.lucide-server-off')?.parentElement?.className,
    ).toContain('text-destructive')
    const statusRow = dialog.querySelector('section[aria-label=Restore] dl')!
      .children[1]!
    expect(
      statusRow.querySelector(
        status === 'failed'
          ? 'svg.lucide-circle-alert'
          : 'svg.lucide-circle-check',
      ),
    ).not.toBeNull()
    expect(statusRow.querySelector('dd')?.className).toContain(
      status === 'failed' ? 'text-destructive' : 'text-success',
    )
    if (status === 'failed')
      expect(statusRow.nextElementSibling?.textContent).toBe(
        'MessageChecksum mismatch',
      )
    expect(
      [...dialog.querySelectorAll('dt')].every((el) =>
        el.className.includes('text-muted-foreground'),
      ),
    ).toBe(true)
    expect(dialog.querySelector('[type="submit"]')).toBeNull()
    expect(
      dialog.querySelectorAll('[aria-label="Restored contents"] li'),
    ).toHaveLength(1)
  },
)

test('empty content categories are shown immediately', async () => {
  await mount(vi.fn<Restore>().mockResolvedValue(undefined))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'No volumes',
  )
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(1)
})
