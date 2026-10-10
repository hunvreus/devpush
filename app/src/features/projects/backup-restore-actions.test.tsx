// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { BackupRunRestoreActions } from './backup-restore-actions'
import type {
  ProjectBackupArtifact,
  ProjectBackupRun,
} from '@/server/projects/types'

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
  vi.unstubAllGlobals()
})
type Restore = ComponentProps<typeof BackupRunRestoreActions>['onRestore']
async function mount(
  onRestore: Restore,
  source = artifact,
  volumes: Array<string> = [],
  targetServerName = 'Server',
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
      <BackupRunRestoreActions
        projectId="p"
        targetServerName={targetServerName}
        artifacts={[source]}
        composeServices={['postgres']}
        composeVolumes={volumes}
        disabled={false}
        restoringArtifactId={null}
        run={run}
        onRestore={onRestore}
      />,
    ),
  )
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Restore')!
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

test('volume restore shows a short title, fixed backup details and the Compose target', async () => {
  const restore = vi.fn<Restore>().mockResolvedValue(undefined)
  const volume = {
    ...artifact,
    type: 'volume' as const,
    objectKey: 'volumes/dp_p000000000_e000000000_test_data.tar.gz',
  }
  await mount(restore, volume, ['test_data'])
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('Restore backup')
  expect(dialog.textContent).toContain('10 B')
  expect(
    dialog.querySelector('[aria-label="Source backup"]')?.textContent,
  ).toContain(volume.objectKey.split('/').at(-1))
  expect(
    dialog
      .querySelector('[aria-label="Copy full server path"]')
      ?.getAttribute('title'),
  ).toBe(volume.objectKey)
  expect(dialog.querySelector('[role="note"]')?.textContent).toContain(
    'The application stops during restoration.',
  )
  expect(
    dialog.querySelector('[aria-label="Restore target"] [role="note"]'),
  ).toBeNull()
  expect(
    dialog.querySelector('[aria-label="Source backup"]')?.textContent,
  ).toContain('On Server')
  expect(
    dialog.querySelector('[aria-label="Restore target"]')?.textContent,
  ).toContain('test_data')
  expect(dialog.textContent).toContain('Compose volume (required)')
  expect(
    dialog.querySelector('[aria-label="Restore target"]')?.textContent,
  ).not.toContain('dp_p000000000_e000000000_test_data')
  expect(document.querySelector('[aria-label="Backup run actions"]')).toBeNull()
  expect(dialog.querySelector('input[readonly]')).toBeNull()
  await queue()
  expect(restore).toHaveBeenCalledWith(
    expect.objectContaining({ targetVolume: 'test_data', artifact: volume }),
  )
})

test('remote source shows its object key separately from the current restore target', async () => {
  const restore = vi.fn<Restore>()
  const remote = {
    ...artifact,
    storage: 'remote' as const,
    objectKey: 'projects/p/backups/run/databases/01-postgres.sql.gz',
  }
  await mount(restore, remote, [], 'Current server')
  const source = document.querySelector('[aria-label="Source backup"]')!
  const target = document.querySelector('[aria-label="Restore target"]')!
  expect(source.textContent).toContain('S3-compatible storage')
  expect(source.textContent).toContain('01-postgres.sql.gz')
  expect(
    source
      .querySelector('[aria-label="Copy S3 object key"]')
      ?.getAttribute('title'),
  ).toBe(remote.objectKey)
  expect(target.textContent).toContain('Current server')
  expect(target.textContent).not.toContain(remote.objectKey)
  expect(restore).not.toHaveBeenCalled()
})
