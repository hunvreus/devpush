// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { BackupPolicyDialog } from './project-backup-policy'
import { projectContext } from '@/test/project-context'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  navigate: vi.fn(),
  saved: vi.fn(),
}))
vi.mock('@/server/projects/functions', () => ({
  saveProjectBackupConfigs: mocks.save,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('@/lib/project-context-query', () => ({
  setProjectContextQueryData: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function click(label: string) {
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === label)!
      .click(),
  )
}
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
        <BackupPolicyDialog
          backupConfigs={[]}
          context={{
            ...projectContext,
            environments: [...projectContext.environments],
          }}
          onSaved={mocks.saved}
          projectName="project"
          teamSlug="team"
        >
          <button>New policy</button>
        </BackupPolicyDialog>,
      ),
    )
  await render()
  await click('New policy')
  return { render }
}
async function name(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[id^="backup-name-"]',
    )!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
test('context refresh does not erase an in-progress policy name', async () => {
  const view = await mount()
  await name('My nightly backup')
  await view.render()
  expect(
    document.querySelector<HTMLInputElement>('input[id^="backup-name-"]')!
      .value,
  ).toBe('My nightly backup')
})
test('policy name length is validated before a request', async () => {
  await mount()
  await name('x'.repeat(101))
  await click('Create policy')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('100')
})
test('pending creation locks edits and dismissal and preserves failed values for retry', async () => {
  let reject!: (error: Error) => void
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await mount()
  await click('Create policy')
  expect(document.querySelector('fieldset')?.disabled).toBe(true)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => reject(new Error('HTTPError')))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to save backup policy.',
  )
  mocks.save.mockResolvedValueOnce(projectContext)
  await click('Create policy')
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
