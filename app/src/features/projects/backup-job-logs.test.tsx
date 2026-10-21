import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { BackupJobLogs } from './backup-job-logs'

vi.mock('@/features/logs/log-scroll-area', () => ({
  LogScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
let queryClient: QueryClient
let root: ReturnType<typeof createRoot> | undefined
let node: HTMLDivElement
async function mount(errorMessage: string | null = null) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <BackupJobLogs
          teamSlug="team"
          operation={{ id: 'job', type: 'restore', errorMessage }}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    ),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
afterEach(async () => {
  await act(async () => root?.unmount())
  node.remove()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
test('reads persisted output over HTTP and retains the terminal error', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      content: 'Restoring volume.\nRestore succeeded.',
      nextOffset: new TextEncoder().encode(
        'Restoring volume.\nRestore succeeded.',
      ).length,
    }),
  )
  vi.stubGlobal('fetch', fetch)
  await mount('Checksum mismatch')
  expect(fetch).toHaveBeenCalledWith(
    '/api/agents/job-logs?type=restore&id=job&offset=0',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
  expect(document.body.querySelector('pre')?.textContent).toContain(
    'Restore succeeded.',
  )
  expect(document.body.textContent).toContain('Checksum mismatch')
  expect(document.body.textContent).toContain(
    'Output from this restore operation. Logs are retained for up to 14 days.',
  )
})
test('failed reads show retry without losing the recorded error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('', { status: 500 })),
  )
  await mount('Checksum mismatch')
  expect(document.body.textContent).toContain('Unable to load logs')
  expect(document.body.textContent).toContain('Checksum mismatch')
  expect(document.body.textContent).toContain('Retry')
})
test('pending reads keep centered loading and the spinner', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
  await mount()
  expect(document.body.querySelector('[role="status"] svg')).not.toBeNull()
  expect(document.body.textContent).toContain('Loading logs')
})

test('closing retains output through the exit animation and stops polling', async () => {
  const original = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const styles = original(element)
    return new Proxy(styles, {
      get(target, property) {
        if (property === 'animationName' && element.hasAttribute('data-slot'))
          return element.getAttribute('data-state') === 'closed'
            ? 'fade-out'
            : 'fade-in'
        return Reflect.get(target, property)
      },
    })
  })
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ content: 'Restore succeeded.', nextOffset: 18 }),
    )
  vi.stubGlobal('fetch', fetch)
  await mount()
  const output = document.body.querySelector('pre')!
  await act(async () =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <BackupJobLogs teamSlug="team" operation={null} onClose={() => {}} />
      </QueryClientProvider>,
    ),
  )
  expect(
    document.body
      .querySelector('[data-slot="dialog-content"]')
      ?.getAttribute('data-state'),
  ).toBe('closed')
  expect(document.body.querySelector('pre')).toBe(output)
  expect(output.textContent).toBe('Restore succeeded.')
  expect(fetch).toHaveBeenCalledTimes(1)
})
