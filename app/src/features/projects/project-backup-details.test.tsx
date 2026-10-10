// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ProjectBackupDetails } from './project-backup-details'
import { TooltipProvider } from '@/components/ui/tooltip'
import { projectContext } from '@/test/project-context'
import type { ProjectBackupConfig } from '@/server/projects/types'

const mocks = vi.hoisted(() => ({ save: vi.fn(), navigate: vi.fn() }))
vi.mock('@/server/projects/functions', () => ({
  saveProjectBackupConfigs: mocks.save,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  useRouter: () => ({ navigate: mocks.navigate }),
  Link: ({
    children,
    ...props
  }: {
    children: ReactNode
    'aria-label'?: string
  }) => <a aria-label={props['aria-label']}>{children}</a>,
}))
vi.mock('@/lib/project-context-query', () => ({
  setProjectContextQueryData: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }))
vi.mock('./project-heading', () => ({ ProjectHeading: () => null }))
vi.mock('@/components/settings-layout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => (
    <TooltipProvider>
      <main>{children}</main>
    </TooltipProvider>
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
  project: {
    ...projectContext.project,
    runtimeConfig: {
      ...projectContext.project.runtimeConfig,
      path: 'compose.yml',
    },
  },
  backupConfigs: [backup],
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(
  role: 'owner' | 'member' = 'owner',
  volumes: ProjectBackupConfig['volumes'] = backup.volumes,
  policy: ProjectBackupConfig = backup,
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
  })
  const render = async () =>
    act(async () =>
      root.render(
        <ProjectBackupDetails
          backupId="b"
          context={{
            ...context,
            team: { ...context.team, role },
            backupConfigs: [{ ...policy, volumes }],
          }}
        />,
      ),
    )
  await render()
  return { node, render }
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function save(node: HTMLElement) {
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('#general button')]
      .find((button) => button.textContent === 'Save')!
      .click(),
  )
}
test('context refresh preserves an unfinished backup edit', async () => {
  const { node, render } = await mount()
  await fill(node.querySelector('#backup-policy-name-b')!, 'Edited')
  await render()
  expect(
    node.querySelector<HTMLInputElement>('#backup-policy-name-b')!.value,
  ).toBe('Edited')
})
test('retention maximum is rejected inline before sending', async () => {
  const { node } = await mount()
  await fill(node.querySelector('#retention input[type="number"]')!, '10001')
  await save(node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(node.querySelector('#retention')?.textContent).toContain('10,000')
})
test('failed saves are form errors and pending fields stay locked', async () => {
  let reject!: (error: Error) => void
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const { node } = await mount()
  await fill(node.querySelector('#backup-policy-name-b')!, 'Edited')
  await save(node)
  expect(
    node.querySelector('#backup-policy-name-b')?.matches(':disabled'),
  ).toBe(true)
  await act(async () => reject(new Error('HTTPError')))
  expect(
    node.querySelector('#backup-policy-form-error')?.textContent,
  ).toContain('Unable to save backup policy.')
  expect(
    node.querySelector<HTMLInputElement>('#backup-policy-name-b')!.value,
  ).toBe('Edited')
  mocks.save.mockResolvedValueOnce({
    ...context,
    backupConfigs: [{ ...backup, name: 'Edited' }],
  })
  await save(node)
  expect(mocks.save).toHaveBeenCalledTimes(2)
})

test('fractional retention counts are marked on their own field', async () => {
  const { node } = await mount()
  const input = node.querySelector<HTMLInputElement>(
    '#retention input[type="number"]',
  )!
  await fill(input, '1.5')
  await save(node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(
    document.getElementById('retention.local.count-error')?.textContent,
  ).toContain('whole number')
})

test('unconverted custom targets require a supported database engine', async () => {
  const { node } = await mount('owner', backup.volumes, {
    ...backup,
    databaseDumps: [
      {
        service: 'postgres',
        engine: 'needs_configuration',
        database: '',
        legacyCommand: 'custom',
      },
    ],
  })
  await fill(node.querySelector('#backup-policy-name-b')!, 'Edited')
  await save(node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(
    node
      .querySelector('[aria-label="Database engine"]')
      ?.getAttribute('aria-invalid'),
  ).toBe('true')
})

test('removing a volume target preserves database dump targets on save', async () => {
  const policy = {
    ...backup,
    databaseDumps: [
      { service: 'postgres', engine: 'postgres' as const, database: '' },
    ],
  }
  const { node } = await mount('owner', { mode: 'allNamed', names: [] }, policy)
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('[aria-label="Remove volume target"]')!
      .click(),
  )
  mocks.save.mockResolvedValueOnce(context)
  await save(node)
  const saved = mocks.save.mock.calls[0]![0].data.backupConfigs[0]
  expect(saved.volumes).toEqual({ mode: 'none', names: [] })
  expect(saved.databaseDumps).toEqual(policy.databaseDumps)
})

test('detail deletion confirms and reports failures inside its dialog', async () => {
  mocks.save.mockRejectedValueOnce(new Error('HTTPError'))
  const { node } = await mount()
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('#danger button')]
      .find((button) => button.textContent === 'Delete policy')!
      .click(),
  )
  expect(mocks.save).not.toHaveBeenCalled()
  await act(async () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ]
      .find((button) => button.textContent === 'Delete policy')!
      .click(),
  )
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    'Unable to delete backup policy.',
  )
})

test('members see disabled backup configuration without save or delete controls', async () => {
  const { node } = await mount('member')
  expect(node.querySelector('fieldset')?.disabled).toBe(true)
  expect(node.textContent).not.toContain('Delete policy')
  expect(
    [...node.querySelectorAll('button')].some(
      (button) => button.textContent === 'Save',
    ),
  ).toBe(false)
})
test('preserves all-named volume selection when repository metadata has no volumes', async () => {
  const { node } = await mount('owner', { mode: 'allNamed', names: [] })
  expect(node.querySelector('#targets')?.textContent).toContain(
    'All named volumes',
  )
})

test('policy uses a workspace destination without exposing credential fields', async () => {
  context.backupConfigs = [
    {
      ...backup,
      destination: { storageId: 's', prefix: 'project-folder' },
      retention: {
        ...backup.retention,
        remote: { ...backup.retention.remote, enabled: true },
      },
    },
  ]
  const withStorage = Object.assign(context, {
    backupStorage: [
      {
        id: 's',
        name: 'Shared storage',
        bucket: 'shared-bucket',
        region: 'auto',
        endpoint: null,
        hasSecret: true,
      },
    ],
  })
  try {
    const { node } = await mount(
      'owner',
      backup.volumes,
      context.backupConfigs[0],
    )
    expect(node.querySelector('#backup-storage-b')).not.toBeNull()
    expect(node.querySelector('#destination')?.textContent).toContain(
      'Shared storage',
    )
    for (const name of [
      'access-key-id',
      'secret-access-key',
      'bucket',
      'endpoint',
    ])
      expect(node.querySelector(`#backup-${name}-b`)).toBeNull()
    expect(node.querySelector('#backup-prefix-b')).toBeNull()
    expect(
      node.querySelector('[aria-label="Manage backup storage"] svg'),
    ).not.toBeNull()
    await fill(node.querySelector('#backup-policy-name-b')!, 'Updated policy')
    mocks.save.mockResolvedValue(withStorage)
    await save(node)
    expect(
      mocks.save.mock.calls[0]![0].data.backupConfigs[0].destination,
    ).toEqual({ storageId: 's', prefix: 'project-folder' })
  } finally {
    context.backupConfigs = [backup]
    withStorage.backupStorage = []
  }
})
