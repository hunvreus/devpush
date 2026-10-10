import { invalidateResourceQueries } from '@/lib/resource-cache'
import type { ProjectContext } from '@/server/projects/types'
// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type * as EnvironmentSettings from './project-environment-settings'
import { ProjectSettings } from './project-settings'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createComposeRuntimeConfig } from '@/server/projects/runtime-config'
import { projectContext as context } from '@/test/project-context'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  deleteProject: vi.fn(),
  warning: vi.fn(),
  routes: vi.fn(),
  domains: vi.fn(),
  envVars: vi.fn(),
  environments: vi.fn(),
  navigate: vi.fn(),
  cache: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@/server/projects/functions', () => ({
  saveProjectSettings: mocks.save,
  saveProjectEnvVars: mocks.envVars,
  saveProjectEnvironments: mocks.environments,
  deleteProjectAction: mocks.deleteProject,
  saveProjectDomains: mocks.domains,
  saveProjectRoutes: mocks.routes,
  verifyProjectDomainAction: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ teamSlug: 'team' }),
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@/lib/project-context-query', () => ({
  setProjectContextQueryData: mocks.cache,
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: mocks.success, warning: mocks.warning },
}))
vi.mock('./project-heading', () => ({ ProjectHeading: () => null }))
vi.mock('./project-environment-settings', async (importOriginal) => ({
  EnvironmentServersSettingsSection: () => null,
  EnvironmentSettingsSection: (
    await importOriginal<typeof EnvironmentSettings>()
  ).EnvironmentSettingsSection,
  EnvironmentVariablesSettingsSection: (
    await importOriginal<typeof EnvironmentSettings>()
  ).EnvironmentVariablesSettingsSection,
}))
vi.mock('./repository-picker-dialog', () => ({
  RepositoryPickerDialog: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@/components/settings-layout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  SettingsSection: ({
    children,
    footer,
    id,
  }: {
    children: ReactNode
    footer: ReactNode
    id: string
  }) => (
    <section id={id}>
      {children}
      {footer}
    </section>
  ),
}))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
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
      <TooltipProvider>
        <ProjectSettings context={context} />
      </TooltipProvider>,
    ),
  )
  cleanup.push(async () => {
    await act(async () => root.unmount())
    node.remove()
  })
  return node
}
async function fill(node: HTMLElement, id: string, value: string) {
  const input = node.ownerDocument.getElementById(id) as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function save(node: HTMLElement, section = 'general') {
  const button = [
    ...node.querySelectorAll<HTMLButtonElement>(`#${section} button`),
  ].find((item) => item.textContent === 'Save')!
  await act(async () => button.click())
}

test('blank project name is required and focused without sending a request', async () => {
  const node = await mount()
  await fill(node, 'project-name', '')
  await save(node)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(node.querySelector('#project-name-error')?.textContent).toContain(
    'Enter a project name',
  )
  expect(document.activeElement?.id).toBe('project-name')
  expect(mocks.error).not.toHaveBeenCalled()
})
test('invalid build fields show independent inline errors', async () => {
  const node = await mount()
  await fill(node, 'compose-path', '../outside.yml')
  await fill(node, 'deploy-timeout', '30')
  await fill(node, 'readiness', 'health')
  await save(node, 'build-and-deploy')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(node.querySelector('#compose-path-error')?.textContent).toContain(
    'within the repository',
  )
  expect(node.querySelector('#deploy-timeout-error')?.textContent).toContain(
    '60 seconds',
  )
  expect(node.querySelector('#readiness-error')?.textContent).toContain(
    'start with /',
  )
})

test('server name conflict stays inline and preserves the attempted name', async () => {
  const node = await mount()
  await fill(node, 'project-name', 'taken')
  mocks.save.mockResolvedValueOnce({
    context: null,
    fieldErrors: { projectName: 'Project names must be unique within a team.' },
  })
  await save(node)
  expect(node.querySelector('#project-name-error')?.textContent).toContain(
    'unique',
  )
  expect(node.querySelector<HTMLInputElement>('#project-name')?.value).toBe(
    'taken',
  )
  expect(mocks.success).not.toHaveBeenCalled()
  expect(mocks.error).not.toHaveBeenCalled()
})

test('pending submission locks edits and repeat submits until the saved view is ready', async () => {
  const node = await mount()
  await fill(node, 'project-name', 'renamed')
  let resolve!: (value: { context: ProjectContext; fieldErrors: null }) => void
  mocks.save.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await save(node)
  expect(node.querySelector('#project-name')?.matches(':disabled')).toBe(true)
  await act(async () =>
    node
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(mocks.save).toHaveBeenCalledTimes(1)
  await act(async () =>
    resolve({
      context: { ...context, project: { ...context.project, name: 'renamed' } },
      fieldErrors: null,
    }),
  )
  expect(mocks.navigate).toHaveBeenCalledTimes(1)
  expect(mocks.success).toHaveBeenCalledTimes(1)
  expect(node.querySelector('#project-name')?.matches(':disabled')).toBe(false)
})

test('network failure stays at the form, preserves input, and permits retry', async () => {
  const node = await mount()
  await fill(node, 'project-name', 'renamed')
  mocks.save.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await save(node)
  expect(node.querySelector('#general [role="alert"]')?.textContent).toContain(
    'Unable to connect',
  )
  expect(node.querySelector<HTMLInputElement>('#project-name')?.value).toBe(
    'renamed',
  )
  mocks.save.mockResolvedValueOnce({
    context: { ...context, project: { ...context.project, name: 'renamed' } },
    fieldErrors: null,
  })
  await save(node)
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(node.querySelector('#general [role="alert"]')).toBeNull()
})

test('saving build settings accepts whole seconds and preserves unsaved general edits', async () => {
  const node = await mount()
  await fill(node, 'project-name', 'unsaved')
  await fill(node, 'deploy-timeout', '61')
  mocks.save.mockResolvedValueOnce({
    context: {
      ...context,
      project: {
        ...context.project,
        runtimeConfig: createComposeRuntimeConfig({ timeoutSeconds: 61 }),
      },
    },
    fieldErrors: null,
  })
  await save(node, 'build-and-deploy')
  expect(mocks.save.mock.calls[0]?.[0].data.projectName).toBe('project')
  expect(mocks.save.mock.calls[0]?.[0].data.runtimeConfig.timeoutSeconds).toBe(
    61,
  )
  expect(node.querySelector<HTMLInputElement>('#project-name')?.value).toBe(
    'unsaved',
  )
})

async function clickText(node: HTMLElement, label: string) {
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === label)!
      .click(),
  )
}
test('route rows validate required service and integer port inline before sending', async () => {
  const node = await mount()
  await clickText(node, 'Add route')
  await save(node, 'routes')
  expect(mocks.routes).not.toHaveBeenCalled()
  expect(
    node
      .querySelector('[aria-label="Route service"]')
      ?.getAttribute('aria-invalid'),
  ).toBe('true')
  expect(node.querySelector('#routes')?.textContent).toContain(
    'Enter a service name.',
  )
})
test('domain host validates inline instead of sending an invalid request', async () => {
  const node = await mount()
  await clickText(node, 'Add domain')
  await save(node, 'domains')
  expect(mocks.domains).not.toHaveBeenCalled()
  expect(
    node
      .querySelector('[aria-label="Domain host"]')
      ?.getAttribute('aria-invalid'),
  ).toBe('true')
  expect(node.querySelector('#domains')?.textContent).toContain(
    'Enter a domain hostname.',
  )
})

test('route failure preserves values, pending locks controls, and retry preserves unsaved domains', async () => {
  let reject!: (error: Error) => void
  mocks.routes.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await clickText(node, 'Add route')
  await fill(node, 'routes.0.service', 'web')
  await clickText(node, 'Add domain')
  await fill(node, 'domains.0.host', 'unsaved.example.com')
  await save(node, 'routes')
  expect(
    node
      .querySelector('#project-routes-form fieldset')
      ?.hasAttribute('disabled'),
  ).toBe(true)
  await act(async () =>
    node
      .querySelector('form#project-routes-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(mocks.routes).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(node.querySelector('#routes')?.textContent).toContain(
    'Unable to save routes.',
  )
  expect(mocks.error).not.toHaveBeenCalled()
  mocks.routes.mockResolvedValueOnce({
    ...context,
    routes: [{ path: '/', service: 'web', port: 80, stripPrefix: false }],
  })
  await save(node, 'routes')
  expect(mocks.routes).toHaveBeenCalledTimes(2)
  expect(
    (document.getElementById('domains.0.host') as HTMLInputElement).value,
  ).toBe('unsaved.example.com')
})
test('domain save preserves failures, locks pending controls, and retries normalized input', async () => {
  let reject!: (error: Error) => void
  mocks.domains.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await clickText(node, 'Add domain')
  await fill(node, 'domains.0.host', ' EXAMPLE.com ')
  await save(node, 'domains')
  expect(
    node
      .querySelector('#project-domains-form fieldset')
      ?.hasAttribute('disabled'),
  ).toBe(true)
  await act(async () =>
    node
      .querySelector('form#project-domains-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(mocks.domains).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(node.querySelector('#domains')?.textContent).toContain(
    'Unable to save domains.',
  )
  expect(mocks.error).not.toHaveBeenCalled()
  mocks.domains.mockResolvedValueOnce({ ...context, domains: [] })
  await save(node, 'domains')
  expect(mocks.domains).toHaveBeenLastCalledWith({
    data: {
      teamSlug: 'team',
      projectName: 'project',
      domains: [
        { host: 'example.com', environmentId: 'e', basePath: '', https: true },
      ],
    },
  })
})

test('environment variable keys are required inline and duplicate keys stay on their row', async () => {
  const node = await mount()
  await clickText(node, 'Add variable')
  await save(node, 'environment-variables')
  expect(mocks.envVars).not.toHaveBeenCalled()
  expect(node.querySelector('#environment-variables')?.textContent).toContain(
    'Enter a variable key.',
  )
})

test('variable failure preserves values and retry locks all pending inputs', async () => {
  let reject!: (error: Error) => void
  mocks.envVars.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await clickText(node, 'Add variable')
  await fill(node, 'envVars.0.key', ' API_KEY ')
  await save(node, 'environment-variables')
  expect(
    node.querySelector('#project-env-form fieldset')?.hasAttribute('disabled'),
  ).toBe(true)
  await act(async () =>
    node
      .querySelector('#project-env-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(mocks.envVars).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(node.querySelector('#environment-variables')?.textContent).toContain(
    'Unable to save environment variables.',
  )
  expect(mocks.error).not.toHaveBeenCalled()
  mocks.envVars.mockResolvedValueOnce({
    ...context,
    envVars: [{ key: 'API_KEY', value: '', environment: '' }],
  })
  await save(node, 'environment-variables')
  expect(mocks.envVars).toHaveBeenLastCalledWith({
    data: {
      teamSlug: 'team',
      projectName: 'project',
      envVars: [{ key: 'API_KEY', value: '', environment: '' }],
    },
  })
})
test('duplicate variable keys report the second row without sending', async () => {
  const node = await mount()
  await clickText(node, 'Add variable')
  await fill(node, 'envVars.0.key', 'TOKEN')
  await clickText(node, 'Add variable')
  await fill(node, 'envVars.1.key', 'TOKEN')
  await save(node, 'environment-variables')
  expect(mocks.envVars).not.toHaveBeenCalled()
  expect(document.getElementById('envVars.1.key-error')?.textContent).toContain(
    'unique per environment',
  )
  expect(document.activeElement?.id).toBe('envVars.1.key')
})
test('invalid env import stays open with an error and inserts no partial rows', async () => {
  const node = await mount()
  await act(async () =>
    node.querySelector<HTMLButtonElement>('[aria-label="Paste .env"]')!.click(),
  )
  const input = document.getElementById(
    'env-file-content',
  ) as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, 'VALID=yes\ninvalid line')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await clickText(document.body, 'Insert')
  expect(document.getElementById('env-file-error')?.textContent).toContain(
    'Line 2',
  )
  expect(
    node.querySelector('[aria-label="Environment variable key"]'),
  ).toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, 'VALID=yes')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await clickText(document.body, 'Insert')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(
    (document.getElementById('envVars.0.key') as HTMLInputElement).value,
  ).toBe('VALID')
})

test('new environments validate required fields before save', async () => {
  const node = await mount()
  await clickText(node, 'Add environment')
  await save(node, 'environments')
  expect(mocks.environments).not.toHaveBeenCalled()
  expect(node.querySelector('#environments')?.textContent).toContain(
    'Enter an environment name.',
  )
  expect(node.querySelector('#environments')?.textContent).toContain(
    'Enter a branch pattern.',
  )
})
test('typing a duplicate production identifier does not lock the new row', async () => {
  const node = await mount()
  await clickText(node, 'Add environment')
  const inputs = node.querySelectorAll<HTMLInputElement>(
    '[aria-label="Environment identifier"]',
  )
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(inputs[1], 'production')
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(inputs[1]!.readOnly).toBe(false)
  expect(
    node.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Remove environment"]',
    )[1]!.disabled,
  ).toBe(false)
})

test('environment saves lock controls, retain failed edits, and allow retry', async () => {
  let reject!: (error: Error) => void
  mocks.environments.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await fill(node, 'environments.0.branch', 'release/*')
  await save(node, 'environments')
  expect(
    node
      .querySelector('#project-environments-form fieldset')
      ?.hasAttribute('disabled'),
  ).toBe(true)
  await act(async () =>
    node
      .querySelector('#project-environments-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(mocks.environments).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('HTTPError')))
  expect(node.querySelector('#environments')?.textContent).toContain(
    'Unable to save environments.',
  )
  expect(
    (document.getElementById('environments.0.branch') as HTMLInputElement)
      .value,
  ).toBe('release/*')
  expect(mocks.error).not.toHaveBeenCalled()
  mocks.environments.mockResolvedValueOnce({
    ...context,
    environments: context.environments.map((row) => ({
      ...row,
      branch: 'release/*',
    })),
  })
  await save(node, 'environments')
  expect(mocks.environments).toHaveBeenCalledTimes(2)
  expect(
    node
      .querySelector('#project-environments-form fieldset')
      ?.hasAttribute('disabled'),
  ).toBe(false)
})

test('project deletion requires exact confirmation, locks pending edits and closes on success', async () => {
  let reject!: (error: Error) => void
  mocks.deleteProject.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  const node = await mount()
  await clickText(node, 'Delete project')
  await fill(node, 'delete-project-confirmation', 'wrong')
  const action = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="alertdialog"] button',
    ),
  ].find((button) => button.textContent === 'Delete project')!
  expect(action.disabled).toBe(true)
  await fill(node, 'delete-project-confirmation', 'project')
  await act(async () => action.click())
  expect(
    (document.getElementById('delete-project-confirmation') as HTMLInputElement)
      .disabled,
  ).toBe(true)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => reject(new Error('HTTPError')))
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    'Unable to delete project.',
  )
  mocks.deleteProject.mockResolvedValueOnce(undefined)
  mocks.navigate.mockRejectedValueOnce(new Error('offline'))
  await act(async () => action.click())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(
    [...node.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Delete project',
    )?.disabled,
  ).toBe(true)
  expect(invalidateResourceQueries).toHaveBeenCalledWith(
    expect.anything(),
    'team',
  )
  expect(mocks.deleteProject).toHaveBeenCalledTimes(2)
})

vi.mock('@/lib/resource-cache', () => ({
  invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
}))
