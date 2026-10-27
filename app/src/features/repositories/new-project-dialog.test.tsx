import type * as ReactQuery from '@tanstack/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { NewProjectRouteDialog } from './new-project-dialog'

let activeClient: QueryClient
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  repositories: vi.fn(),
  empty: false,
  refreshError: false,
  navigate: vi.fn(),
  shellPending: false,
  warning: vi.fn(),
}))
vi.mock('#devpush/server/projects/functions', () => ({
  createProject: mocks.create,
  getRepositorySelectionRepositories: mocks.repositories,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>()
  return {
    ...actual,
    useQueryClient: () => ({}),
    queryOptions: <T,>(options: T) => options,
    useQuery: (options: Parameters<typeof actual.useQuery>[0]) =>
      options.queryKey[0] === 'installation-repositories'
        ? actual.useQuery(options, activeClient)
        : options.queryKey[0] === 'team-context'
          ? {
              isPending: mocks.shellPending,
              data: mocks.shellPending
                ? undefined
                : {
                    team: {
                      id: 't',
                      slug: 'team',
                      name: 'Team',
                      role: 'owner',
                      color: 'lime',
                      image: null,
                    },
                    servers: [],
                  },
              error: null,
            }
          : {
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
            },
  }
})
vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
  vi.resetAllMocks()
  mocks.shellPending = false
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  activeClient = client
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NewProjectRouteDialog teamSlug="team" />
      </QueryClientProvider>,
    ),
  )
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
    client.clear()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  if (!select) return root
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
  expect(mocks.navigate).not.toHaveBeenCalled()
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
test('successful creation closes the dialog before cache refresh and navigation', async () => {
  await mount()
  let refreshed!: () => void
  mocks.invalidate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        refreshed = resolve
      }),
  )
  mocks.create.mockResolvedValueOnce({ name: 'repo' })
  await submit()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.navigate).not.toHaveBeenCalled()
  await act(async () => refreshed())
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/$teamSlug/projects/$projectName',
    params: { teamSlug: 'team', projectName: 'repo' },
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test.each(['refresh', 'navigation'])(
  'successful creation stays closed when %s fails',
  async (failure) => {
    await mount()
    mocks.create.mockResolvedValueOnce({ name: 'repo' })
    if (failure === 'refresh')
      mocks.invalidate.mockRejectedValueOnce(new Error('refresh failed'))
    else mocks.navigate.mockRejectedValueOnce(new Error('navigation failed'))
    await submit()
    expect(mocks.warning).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  },
)

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
  await act(async () => {
    retry!.click()
    await vi.advanceTimersByTimeAsync(20)
  })
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

vi.mock('#devpush/lib/resource-cache', () => ({
  invalidateResourceQueries: mocks.invalidate,
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

test('route dialog preserves its overlay while initial context loads', async () => {
  mocks.shellPending = true
  const root = await mount(false)
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog).not.toBeNull()
  mocks.shellPending = false
  await act(async () =>
    root!.render(
      <QueryClientProvider client={activeClient}>
        <NewProjectRouteDialog teamSlug="team" />
      </QueryClientProvider>,
    ),
  )
  expect(document.querySelector('[role="dialog"]')).toBe(dialog)
  expect(
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Select',
    ),
  ).toBe(true)
})

test('a pending repository request never renders the empty state, including rerenders', async () => {
  mocks.empty = true
  let resolve!: (value: unknown[]) => void
  mocks.repositories.mockImplementation(
    () =>
      new Promise((value) => {
        resolve = value
      }),
  )
  await mount(false)
  expect(document.body.textContent).not.toContain('No repositories found')
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).not.toBeNull()
  await act(async () => {
    resolve([])
    await vi.advanceTimersByTimeAsync(20)
  })
  expect(document.body.textContent).toContain('No repositories found')
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).toBeNull()
  expect(mocks.repositories).toHaveBeenCalledTimes(1)
})
