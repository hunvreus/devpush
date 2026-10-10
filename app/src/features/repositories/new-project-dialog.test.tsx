// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { NewProjectDialog } from './new-project-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  repositories: vi.fn(),
  empty: false,
  refreshError: false,
  navigate: vi.fn(),
  close: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/server/projects/functions', () => ({
  createProject: mocks.create,
  getRepositorySelectionRepositories: mocks.repositories,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  queryOptions: <T,>(options: T) => options,
  useQuery: () => ({
    isPending: false,
    error: mocks.refreshError ? new Error('refresh failed') : null,
    data: {
      github: {
        connected: true,
        login: 'owner',
        appConfigured: true,
        installUrl: null,
        installations: [
          {
            id: 1,
            accountLogin: 'owner',
            accountType: 'User',
            repositorySelection: 'all',
          },
        ],
        repositories: mocks.empty
          ? []
          : [
              {
                id: 1,
                installationId: 1,
                name: 'repo',
                fullName: 'owner/repo',
                owner: 'owner',
                private: false,
                defaultBranch: 'main',
                updatedAt: '2026-10-01',
                permissions: { push: true },
              },
            ],
      },
    },
  }),
}))
vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
  vi.resetAllMocks()
  mocks.empty = false
  mocks.refreshError = false
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function mount(select = true) {
  vi.useFakeTimers()
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
  await act(async () =>
    root.render(
      <NewProjectDialog
        team={{
          id: 't',
          slug: 'team',
          name: 'Team',
          role: 'owner',
          color: 'lime',
          image: null,
        }}
        servers={[]}
        onClose={mocks.close}
      />,
    ),
  )
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  if (!select) return
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Select')!
      .click(),
  )
}
async function fill(value: string) {
  await act(async () => {
    const input = document.getElementById('new-project-name')!
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
      .getElementById('new-project-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}
test('empty name is rejected inline before creation', async () => {
  await mount()
  await fill('')
  await submit()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Enter a project name',
  )
  expect(document.activeElement?.id).toBe('new-project-name')
})
test('pending creation prevents edits, back, dismissal, and repeated submission', async () => {
  await mount()
  let reject!: (error: Error) => void
  mocks.create.mockReturnValueOnce(
    new Promise<void>((_, fail) => {
      reject = fail
    }),
  )
  await submit()
  await submit()
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(mocks.close).not.toHaveBeenCalled()
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(
    document.getElementById('new-project-name')?.matches(':disabled'),
  ).toBe(true)
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === 'Back',
    )?.disabled,
  ).toBe(true)
  await act(async () => reject(new TypeError('Failed to fetch')))
  expect(document.querySelector('#new-project-form')?.textContent).toContain(
    'Unable to connect',
  )
  expect(
    (document.getElementById('new-project-name') as HTMLInputElement).value,
  ).toBe('repo')
})
test('successful creation cannot be repeated when navigation fails', async () => {
  await mount()
  mocks.create.mockResolvedValueOnce({ name: 'repo' })
  mocks.navigate.mockRejectedValueOnce(new Error('navigation failed'))
  await submit()
  expect(mocks.warning).toHaveBeenCalled()
  await submit()
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(
    document.getElementById('new-project-name')?.matches(':disabled'),
  ).toBe(true)
})

test('repository search failures offer an inline retry without reopening creation', async () => {
  mocks.empty = true
  mocks.repositories
    .mockRejectedValueOnce(new Error('HTTPError'))
    .mockResolvedValue([])
  await mount(false)
  const retry = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent === 'Retry')
  expect(retry).toBeDefined()
  await act(async () => retry!.click())
  expect(mocks.repositories).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

test('repository search can be cleared without another repository request', async () => {
  await mount(false)
  const input = document.querySelector<HTMLInputElement>(
    'input[type="search"]',
  )!
  const search = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await search('missing')
  expect(document.body.textContent).toContain('No repositories found')
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).toBeNull()
  await search('')
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
    'repo',
  )
  expect(mocks.repositories).not.toHaveBeenCalled()
})

vi.mock('@/lib/resource-cache', () => ({
  invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
}))

test('failed background refresh retains the repository form and cached results', async () => {
  mocks.refreshError = true
  await mount(false)
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
    'repo',
  )
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to refresh',
  )
})
