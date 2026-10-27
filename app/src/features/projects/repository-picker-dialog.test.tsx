import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
} from '@tanstack/react-query'
// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { RepositoryPickerDialog } from './repository-picker-dialog'

// Keep query notifications within React's act boundary instead of relying on timer ordering.
notifyManager.setScheduler(queueMicrotask)

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  select: vi.fn(),
  emptyTitles: [] as string[],
}))
vi.mock('#devpush/server/projects/functions', () => ({
  getRepositorySelectionRepositories: mocks.load,
}))
vi.mock('#devpush/lib/repository-selection-query', () => ({
  repositorySelectionQueryOptions: () => ({
    queryKey: ['selection'],
    queryFn: async () => selection,
    staleTime: Infinity,
  }),
}))
const selection = {
  github: {
    connected: true,
    installations: [{ id: 1, accountLogin: 'owner' }],
  },
}
vi.mock('#devpush/components/ui/empty', () => ({
  Empty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  EmptyTitle: ({ children }: { children: string }) => {
    mocks.emptyTitles.push(children)
    return <h2>{children}</h2>
  },
}))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
  mocks.emptyTitles = []
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const repo = {
  id: 2,
  installationId: 1,
  name: 'repo',
  fullName: 'owner/repo',
  private: false,
  updatedAt: '2026-10-01',
}
async function click(text: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent === text)
  expect(button, `Button ${text}`).toBeDefined()
  await act(async () => button!.click())
}
async function mount(installationId = 1) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['selection'], selection)
  const root = createRoot(node)
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
    client.clear()
  })
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <RepositoryPickerDialog
          teamSlug="team"
          currentRepo={{ fullName: 'owner/old', id: 1, installationId }}
          onSelect={mocks.select}
        >
          <button>Choose repository</button>
        </RepositoryPickerDialog>
      </QueryClientProvider>,
    ),
  )
  await click('Choose repository')
  return client
}
test('failed repository loading can retry inline and select a repository', async () => {
  mocks.load
    .mockRejectedValueOnce(new Error('HTTPError'))
    .mockResolvedValueOnce([repo])
  await mount()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to load repositories',
  )
  await click('Retry')
  expect(mocks.load).toHaveBeenCalledTimes(2)
  await click('Select')
  expect(mocks.select).toHaveBeenCalledWith({
    fullName: 'owner/repo',
    id: 2,
    installationId: 1,
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
test('a response from a closed dialog cannot replace the reopened selection', async () => {
  let resolveOld!: (value: Array<typeof repo>) => void
  mocks.load
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValueOnce([repo])
  await mount()
  await click('Close')
  await click('Choose repository')
  await act(async () =>
    resolveOld([{ ...repo, id: 3, name: 'stale', fullName: 'owner/stale' }]),
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    'stale',
  )
  await click('Select')
  expect(mocks.select).toHaveBeenCalledWith({
    fullName: 'owner/repo',
    id: 2,
    installationId: 1,
  })
})

test('known connected GitHub never flashes the disconnected empty state', async () => {
  mocks.load.mockImplementation(() => new Promise(() => {}))
  await mount()
  expect(mocks.emptyTitles).not.toContain('Connect GitHub.')
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).not.toBeNull()
  expect(document.body.textContent).not.toContain('No repositories found')
})

test('repository empty state appears only after the request resolves empty', async () => {
  let resolve!: (value: Array<typeof repo>) => void
  mocks.load.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await mount()
  expect(document.body.textContent).not.toContain('No repositories found')
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).not.toBeNull()
  await act(async () => resolve([]))
  expect(document.body.textContent).toContain('No repositories found')
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).toBeNull()
})

test('reopening a recently loaded dialog reuses its list without another skeleton or request', async () => {
  mocks.load.mockResolvedValue([repo])
  await mount()
  expect(document.body.textContent).toContain('repo')
  await click('Close')
  await click('Choose repository')
  expect(mocks.load).toHaveBeenCalledTimes(1)
  expect(
    document.querySelector('[aria-label="Loading repositories"]'),
  ).toBeNull()
  expect(document.body.textContent).toContain('repo')
})

test('a failed refresh keeps the known repository list visible', async () => {
  mocks.load
    .mockResolvedValueOnce([repo])
    .mockRejectedValueOnce(new Error('provider unavailable'))
  const client = await mount()
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['repository-picker', 'team', 1],
    })
  })
  expect(document.querySelector('[role=alert]')?.textContent).toContain(
    'Unable to refresh repositories',
  )
  expect(
    document.querySelector('[aria-label="Repository list"]')?.textContent,
  ).toContain('repo')
})

test('an unavailable prior installation falls back to an accessible installation', async () => {
  mocks.load.mockResolvedValue([repo])
  await mount(999)
  expect(mocks.load).toHaveBeenCalledWith(
    expect.objectContaining({ data: { teamSlug: 'team', installationId: 1 } }),
  )
  expect(
    document.querySelector('[aria-label="Repository list"]')?.textContent,
  ).toContain('repo')
})
