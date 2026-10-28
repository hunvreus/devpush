// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ProjectBackupDetails } from './project-backup-details'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { projectContext } from '#devpush/test/project-context'
import type { ProjectBackupConfig } from '#devpush/server/projects/types'
import { PublicError } from '#devpush/lib/public-error'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('#devpush/server/projects/functions', () => ({
  saveProjectBackupPolicyAction: mocks.save,
  deleteProjectBackupPolicyAction: mocks.save,
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
vi.mock('#devpush/lib/project-context-query', () => ({
  setProjectContextQueryData: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: mocks.error },
}))
vi.mock('./project-heading', () => ({ ProjectHeading: () => null }))
vi.mock('#devpush/components/settings-layout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => (
    <TooltipProvider>
      <main>{children}</main>
    </TooltipProvider>
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
  HTMLElement.prototype.scrollIntoView = vi.fn()
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
  const render = async (revision = backup.settingsVersion) =>
    act(async () =>
      root.render(
        <ProjectBackupDetails
          backupId="b"
          context={{
            ...context,

            team: { ...context.team, role },
            backupConfigs: [{ ...policy, settingsVersion: revision, volumes }],
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

test('dirty policy keeps its original revision after polling and retains input on conflict', async () => {
  const { node, render } = await mount()
  await fill(node.querySelector('#backup-policy-name-b')!, 'My pending edit')
  await render(2)
  mocks.save.mockRejectedValueOnce(new PublicError('SETTINGS_CONFLICT'))
  await save(node)
  expect(mocks.save.mock.calls[0]?.[0].data.settingsVersion).toBe(
    backup.settingsVersion,
  )
  expect(
    node.querySelector<HTMLInputElement>('#backup-policy-name-b')!.value,
  ).toBe('My pending edit')
  expect(document.querySelector('#backup-policy-form-error')).toBeNull()
})
test('retention maximum is rejected inline before sending', async () => {
  const { node } = await mount()
  await fill(node.querySelector('#retention input[type="number"]')!, '10001')
  await save(node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(node.querySelector('#retention')?.textContent).toContain('10,000')
})
test('failed saves use Sonner and pending fields stay locked', async () => {
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
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to save backup policy.'),
  )
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

test('removing a volume target preserves database dump targets on save', async () => {
  const policy = {
    ...backup,
    databaseDumps: [
      { service: 'postgres', engine: 'postgres' as const, database: '' },
    ],
  }
  const { node } = await mount('owner', { mode: 'allNamed', names: [] }, policy)
  const databases = node.querySelector('#databases')!
  for (const label of ['Service', 'Engine', 'Database']) {
    expect(
      [...databases.querySelectorAll('span')].some(
        (span) => span.textContent === label,
      ),
    ).toBe(true)
  }
  expect(databases.querySelector('p.text-muted-foreground')).toBeNull()
  await act(async () =>
    node
      .querySelector('[aria-label="Volumes to back up"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
  )
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === 'No volumes')!
      .click(),
  )
  mocks.save.mockResolvedValueOnce(context)
  await save(node)
  const saved = mocks.save.mock.calls[0]![0].data.policy
  expect(saved.volumes).toEqual({ mode: 'none', names: [] })
  expect(saved.databaseDumps).toEqual(policy.databaseDumps)
})

test('detail deletion confirms and reports failures through Sonner', async () => {
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
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to delete backup policy.'),
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
  expect(
    node.querySelector('[aria-label="Volumes to back up"]')?.textContent,
  ).toBe('All named volumes')
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
        settingsVersion: 1,
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
    expect(mocks.save.mock.calls[0]![0].data.policy.destination).toEqual({
      storageId: 's',
      prefix: 'project-folder',
    })
  } finally {
    context.backupConfigs = [backup]
    withStorage.backupStorage = []
  }
})

test('selected volumes are chips and retain custom names absent from metadata', async () => {
  const { node } = await mount('owner', {
    mode: 'selected',
    names: ['manual_data'],
  })
  expect(
    node.querySelector('[aria-label="Volume manual_data"]')?.textContent,
  ).toContain('manual_data')
  expect(node.querySelectorAll('#volumes [role=combobox]input')).toHaveLength(1)
  expect(node.querySelector('[aria-label="Compose volumes"]')).not.toBeNull()
})

test('saves service and volume names for a future deployment without Compose metadata', async () => {
  const policy = {
    ...backup,
    databaseDumps: [
      { service: 'future_db', engine: 'postgres' as const, database: 'app' },
    ],
  }
  const { node } = await mount(
    'owner',
    { mode: 'selected', names: ['future_data'] },
    policy,
  )
  await fill(node.querySelector('#backup-policy-name-b')!, 'Future backup')
  mocks.save.mockResolvedValueOnce(context)
  await save(node)
  const saved = mocks.save.mock.calls[0]![0].data.policy
  expect(saved.volumes).toEqual({ mode: 'selected', names: ['future_data'] })
  expect(saved.databaseDumps).toEqual(policy.databaseDumps)
})
