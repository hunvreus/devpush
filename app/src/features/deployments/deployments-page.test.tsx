// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { DeploymentsPage } from './deployments-page'
import { projectContext } from '#devpush/test/project-context'
import type { DeploymentsSearch } from './deployment-filters'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team', projectName: 'project' }),
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, dismiss: mocks.dismiss },
}))
vi.mock('#devpush/features/projects/project-heading', () => ({
  ProjectHeading: () => null,
}))
vi.mock('#devpush/features/projects/manual-deploy-dialog', () => ({
  ManualDeployDialog: () => null,
}))
vi.mock('#devpush/features/deployments/deployment-list', () => ({
  DeploymentList: () => null,
}))
vi.mock('#devpush/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string }) => (
    <option value={value}>{value}</option>
  ),
}))
let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(filters: DeploymentsSearch = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  dispose = async () => {
    await act(async () => root.unmount())
    node.remove()
  }
  await act(async () =>
    root.render(<DeploymentsPage context={projectContext} filters={filters} />),
  )
  return node
}
test('rapid filter changes preserve the current navigation search instead of stale props', async () => {
  let search: DeploymentsSearch = {}
  mocks.navigate.mockImplementation((options) => {
    search =
      typeof options.search === 'function'
        ? options.search(search)
        : options.search
    return Promise.resolve()
  })
  const node = await mount()
  const selects = node.querySelectorAll('select')
  await act(async () => {
    selects[1]!.value = 'failed'
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {
    selects[2]!.value = '7d'
    selects[2]!.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(search).toMatchObject({ status: 'failed', date: '7d' })
})
test('reset clears all filters', async () => {
  mocks.navigate.mockResolvedValue(undefined)
  const node = await mount({ status: 'failed', date: '7d' })
  await act(async () =>
    [...node.querySelectorAll('button')]
      .find((button) => button.textContent === 'Reset filters')!
      .click(),
  )
  expect(mocks.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ search: {} }),
  )
})

test('a rejected filter navigation shows safe feedback and can be retried', async () => {
  mocks.navigate
    .mockRejectedValueOnce(new Error('HTTPError: internal details'))
    .mockResolvedValue(undefined)
  const node = await mount({ status: 'failed' })
  const reset = [...node.querySelectorAll('button')].find(
    (button) => button.textContent === 'Reset filters',
  )!
  await act(async () => reset.click())
  expect(mocks.error).toHaveBeenCalledWith(
    'Unable to apply filters. Please try again.',
    { id: 'filter-navigation' },
  )
  await act(async () => reset.click())
  expect(mocks.dismiss).toHaveBeenCalledWith('filter-navigation')
})
