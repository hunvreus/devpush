import type * as ReactQueryModule from '@tanstack/react-query'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ManualDeployDialog } from './manual-deploy-dialog'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import { projectContext } from '#devpush/test/project-context'

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  deploy: vi.fn(),
  navigate: vi.fn(),
  warning: vi.fn(),
  clearQueryCache: () => {},
}))
vi.mock('#devpush/server/projects/functions', () => ({
  getProjectDeployOptions: mocks.options,
  deployProject: mocks.deploy,
}))
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof ReactQueryModule>(
    '@tanstack/react-query',
  )
  const { QueryClient } = actual
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  mocks.clearQueryCache = () => client.clear()
  return { ...actual, useQueryClient: () => client }
})
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('#devpush/lib/project-context-query', () => ({
  invalidateProjectContext: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: mocks.warning } }))
const options = {
  branches: ['main'],
  selectedBranch: 'main',
  environment: projectContext.environments[0],
  commits: [{ sha: '12345678', branch: 'main', message: 'Commit', url: null }],
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  mocks.clearQueryCache()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function click(text: string, scope: ParentNode = document) {
  await act(async () =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === text)!
      .click(),
  )
}
async function mount(active = false) {
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
        <ManualDeployDialog
          environments={projectContext.environments}
          hasActiveDeployment={active}
          projectName="project"
          teamSlug="team"
        >
          <button>Open deploy</button>
        </ManualDeployDialog>
      </TooltipProvider>,
    ),
  )
  await click('Open deploy')
}
test('failed options load shows an inline retry instead of endless loading', async () => {
  mocks.options
    .mockRejectedValueOnce(new Error('HTTPError'))
    .mockResolvedValueOnce(options)
  await mount()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to load deploy options.',
  )
  await click('Retry')
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(1)
  expect(mocks.options).toHaveBeenCalledTimes(2)
})
test('pending deployment cannot be dismissed or submitted twice and failure permits retry', async () => {
  mocks.options.mockResolvedValue(options)
  let reject!: (error: Error) => void
  mocks.deploy.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await mount()
  await click('Deploy')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Cancel',
    )?.disabled,
  ).toBe(true)
  expect(
    dialog
      .querySelector<HTMLInputElement>('input[type="radio"]')
      ?.matches(':disabled'),
  ).toBe(true)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click('Deploy')
  expect(mocks.deploy).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to deploy.',
  )
  mocks.deploy.mockResolvedValueOnce({ deploymentId: 'next' })
  await click('Deploy')
  expect(mocks.deploy).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
test('active deployments require confirmation before queueing', async () => {
  mocks.options.mockResolvedValue(options)
  mocks.deploy.mockResolvedValue({ deploymentId: 'next' })
  await mount(true)
  await click('Deploy')
  expect(mocks.deploy).not.toHaveBeenCalled()
  await click('Continue', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.deploy).toHaveBeenCalledTimes(1)
})

test('late options from a closed dialog cannot replace a reopened selection', async () => {
  let resolveOld!: (value: typeof options) => void
  mocks.options
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValueOnce(options)
  await mount()
  await click('Close')
  await click('Open deploy')
  await act(async () => resolveOld({ ...options, commits: [] }))
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(1)
})
test('successful deployment closes before a failed navigation and reports a warning', async () => {
  mocks.options.mockResolvedValue(options)
  mocks.deploy.mockResolvedValue({ deploymentId: 'next' })
  mocks.navigate.mockRejectedValue(new Error('offline'))
  await mount()
  await click('Deploy')
  expect(mocks.deploy).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.warning).toHaveBeenCalled()
})

test('reopening a fresh commit list reuses cached GitHub options', async () => {
  mocks.options.mockResolvedValue(options)
  await mount()
  await click('Close')
  await click('Open deploy')
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(1)
  expect(mocks.options).toHaveBeenCalledTimes(1)
})

async function chooseBranch(branch: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="Deployment branch"]',
  )!
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  )
  await act(async () => {
    ;[...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent === branch)!
      .click()
  })
}

test('branch selection requests and caches only the chosen branch commits', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const initial = { ...options, branches: ['main', 'feature/new'] }
  mocks.options.mockResolvedValueOnce(initial).mockResolvedValueOnce({
    ...initial,
    selectedBranch: 'feature/new',
    commits: [
      { ...options.commits[0]!, sha: 'abcdef12', branch: 'feature/new' },
    ],
  })
  await mount()
  expect(mocks.options).toHaveBeenCalledTimes(1)
  expect(mocks.options.mock.calls[0]![0].data.branch).toBeUndefined()
  await chooseBranch('feature/new')
  expect(mocks.options).toHaveBeenCalledTimes(2)
  expect(mocks.options.mock.calls[1]![0].data.branch).toBe('feature/new')
  expect(
    document.querySelector('input[type="radio"]')?.parentElement?.textContent,
  ).toContain('abcdef1')
  await chooseBranch('main')
  expect(mocks.options).toHaveBeenCalledTimes(2)
  expect(
    document.querySelector('input[type="radio"]')?.parentElement?.textContent,
  ).toContain('1234567')
})

test('a failed branch load cannot submit a commit from the previous branch', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.options
    .mockResolvedValueOnce({ ...options, branches: ['main', 'feature/new'] })
    .mockRejectedValueOnce(new Error('private provider diagnostic'))
  await mount()
  await chooseBranch('feature/new')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to load deploy options.',
  )
  expect(document.body.textContent).not.toContain('private provider diagnostic')
  await click('Deploy')
  expect(mocks.deploy).not.toHaveBeenCalled()
  expect(
    document.querySelector('[aria-label="Deployment branch"]'),
  ).not.toBeNull()
})
