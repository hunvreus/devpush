// @vitest-environment jsdom
import { act, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { EnvironmentServersSettingsSection } from './project-environment-settings'
import { projectContext } from '#devpush/test/project-context'
import type { ProjectContext } from '#devpush/server/projects/types'

const mocks = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }))
vi.mock('#devpush/server/projects/functions', () => ({
  saveProjectEnvironmentServers: mocks.save,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team' }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('#devpush/lib/project-context-query', () => ({
  setProjectContextQueryData: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.error } }))
vi.mock('#devpush/components/settings-layout', () => ({
  SettingsSection: ({
    children,
    footer,
  }: {
    children: ReactNode
    footer: ReactNode
  }) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}))
vi.mock('./project-settings-section', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ProjectSettingsActionTooltip: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))
const selectContext = createContext({
  value: '',
  onValueChange: (_value: string) => {},
})
vi.mock('#devpush/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) => (
    <selectContext.Provider value={{ value, onValueChange }}>
      {children}
    </selectContext.Provider>
  ),
  SelectTrigger: ({ 'aria-label': label }: { 'aria-label': string }) => {
    const { value, onValueChange } = useContext(selectContext)
    return (
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="__none__">None</option>
        <option value="__default__">Default</option>
        <option value="s1">Server 1</option>
        <option value="s2">Server 2</option>
      </select>
    )
  },
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const render = async (context: ProjectContext) =>
    act(async () =>
      root.render(<EnvironmentServersSettingsSection context={context} />),
    )
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
  })
  await render(projectContext)
  return { node, render }
}
async function choose(node: HTMLElement, label: string, value: string) {
  await act(async () => {
    const input = node.querySelector<HTMLSelectElement>(
      `[aria-label="${label}"]`,
    )!
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function save(node: HTMLElement) {
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Save')!
      .click(),
  )
}
test('new environments can be assigned after a context refresh while unsaved selections survive', async () => {
  const { node, render } = await mount()
  await choose(node, 'Production server override', 's1')
  const env = projectContext.environments[0]!
  await render({
    ...projectContext,
    environments: [
      env,
      { ...env, id: 'staging', name: 'Staging', slug: 'staging' },
    ],
  })
  await choose(node, 'Staging server override', 's2')
  expect(
    node.querySelector<HTMLSelectElement>(
      '[aria-label="Production server override"]',
    )!.value,
  ).toBe('s1')
  expect(
    node.querySelector<HTMLSelectElement>(
      '[aria-label="Staging server override"]',
    )!.value,
  ).toBe('s2')
})
test('failed assignment save retains selection and pending submission locks controls', async () => {
  let reject!: (error: Error) => void
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const { node } = await mount()
  await choose(node, 'Default server', 's1')
  await save(node)
  expect(node.querySelector('fieldset')?.disabled).toBe(true)
  await act(async () =>
    node
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(mocks.save).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to save servers.'),
  )
  expect(
    node.querySelector<HTMLSelectElement>('[aria-label="Default server"]')!
      .value,
  ).toBe('s1')
  mocks.save.mockResolvedValueOnce({
    ...projectContext,
    project: { ...projectContext.project, defaultServerId: 's1' },
  })
  await save(node)
  expect(mocks.save).toHaveBeenCalledTimes(2)
})
