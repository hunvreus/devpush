import { PublicError, publicErrorMessages } from '#devpush/lib/public-error'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { BackupStorageSettings } from './backup-storage-settings'
import type { BackupStorageSummary } from '#devpush/lib/backup-storage-schema'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}))
vi.mock('#devpush/server/backups/storage-functions', () => ({
  saveBackupStorageAction: mocks.save,
  deleteBackupStorageAction: mocks.remove,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }))
const team = {
  settingsVersion: 1,
  id: 't',
  name: 'Team',
  slug: 'team',
  role: 'admin',
  image: null,
  color: 'lime',
} as const
const storage: BackupStorageSummary = {
  settingsVersion: 1,
  id: 's',
  name: 'Backups',
  bucket: 'bucket',
  region: 'auto',
  endpoint: null,
  accessKeyId: 'key',
  hasSecret: true,
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.clearAllMocks()
})
async function mount(role: 'admin' | 'member', rows: BackupStorageSummary[]) {
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
        <BackupStorageSettings team={{ ...team, role }} storage={rows} />
      </TooltipProvider>,
    ),
  )
  return node
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) =>
      item.textContent.trim() === text ||
      item.getAttribute('aria-label') === text,
  )!
  await act(async () => button.click())
}
async function fill(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`#storage-${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}
test('members can read storage metadata without credential or management controls', async () => {
  const node = await mount('member', [storage])
  expect(node.textContent).toContain('Backups')
  expect(node.querySelector('button')).toBeNull()
  expect(node.textContent).not.toContain('key')
})
test('admins add a destination once and refresh workspace and project queries', async () => {
  await mount('admin', [])
  await click('Add storage')
  await fill('name', 'Shared')
  await fill('bucket', 'shared-bucket')
  await fill('accessKeyId', 'access')
  await submit()
  expect(mocks.save).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Enter a secret access key.')
  await fill('secretAccessKey', 'secret')
  mocks.save.mockResolvedValue([{ ...storage, name: 'Shared' }])
  await submit()
  expect(mocks.save).toHaveBeenCalledWith({
    data: {
      teamSlug: 'team',
      settingsVersion: null,
      input: {
        id: undefined,
        name: 'Shared',
        bucket: 'shared-bucket',
        region: 'auto',
        endpoint: '',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
      },
    },
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.invalidate).toHaveBeenCalledWith({
    queryKey: ['project-context', 'team'],
  })
})
test('editing masks the saved secret and keeps it and location readonly', async () => {
  await mount('admin', [storage])
  await click('Settings for Backups')
  for (const id of ['bucket', 'region', 'endpoint'])
    expect(
      document.querySelector<HTMLInputElement>(`#storage-${id}`)!.readOnly,
    ).toBe(true)
  const secret = document.querySelector<HTMLInputElement>(
    '#storage-secretAccessKey',
  )!
  expect(secret.readOnly).toBe(true)
  expect(secret.value).toBe('••••••••••••••••')
  expect(document.body.textContent).not.toContain(
    'Leave empty to keep the saved secret',
  )
  await fill('name', 'Updated')
  mocks.save.mockResolvedValue([{ ...storage, name: 'Updated' }])
  await submit()
  expect(mocks.save.mock.calls[0]![0].data.input.secretAccessKey).toBe('')
})

test('storage removal keeps a referenced destination and displays the server refusal', async () => {
  await mount('admin', [storage])
  await click('Remove Backups')
  expect(mocks.remove).not.toHaveBeenCalled()
  mocks.remove.mockRejectedValueOnce(new PublicError('BACKUP_STORAGE_IN_USE'))
  await click('Remove storage')
  expect(mocks.remove).toHaveBeenCalledWith({
    data: { teamSlug: 'team', storageId: 's', settingsVersion: 1 },
  })
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining(publicErrorMessages.BACKUP_STORAGE_IN_USE),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  mocks.remove.mockResolvedValueOnce([])
  await click('Remove storage')
  expect(document.body.textContent).toContain('No backup storage.')
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})

test('empty creation form shows the required secret error alongside other field errors', async () => {
  await mount('admin', [])
  await click('Add storage')
  await submit()
  expect(mocks.save).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Enter a storage name.')
  expect(document.body.textContent).toContain('Enter an access key ID.')
  expect(document.body.textContent).toContain('Enter a secret access key.')
})
