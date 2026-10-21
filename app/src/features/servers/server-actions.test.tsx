// @vitest-environment jsdom
import { act } from 'react'
import { TeamServers } from './team-servers'
import { projectContext } from '@/test/project-context'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import {
  ServerDetail,
  ServerInstallCallout,
  ServerDangerSection,
} from './server-detail'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  update: vi.fn(),
  install: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  remove: vi.fn(),
  inspect: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/server/servers/functions', () => ({
  updateServer: mocks.update,
  createInstallCommand: mocks.install,
  disableServer: mocks.disable,
  enableServer: mocks.enable,
  deleteServer: mocks.remove,
  getDeleteServerDiagnostic: mocks.inspect,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.refresh, navigate: mocks.refresh }),
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children: ReactNode
    params?: Record<string, string>
    to?: string
    'aria-label'?: string
  }) => (
    <a
      {...props}
      href={to?.replace(/\$([a-zA-Z]+)/g, (_, key) => params?.[key] ?? key)}
    >
      {children}
    </a>
  ),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: mocks.success, warning: mocks.warning },
}))
const server = {
  settingsVersion: 1,
  id: 's',
  name: 'host-1',
  status: 'connected' as const,
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(children: ReactNode) {
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
    root.render(<TooltipProvider>{children}</TooltipProvider>),
  )
  cleanups.push(async () => {
    await act(async () => root.unmount())
    node.remove()
  })
  return node
}
async function click(label: string, scope: ParentNode = document) {
  await act(async () =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === label)!
      .click(),
  )
}
async function confirmName() {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      '[role="alertdialog"] input',
    )!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'host-1')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
test('callout install failures wait for explicit retry', async () => {
  mocks.install.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await mount(<ServerInstallCallout teamSlug="team" server={server} />)
  await click('Generate install command')
  expect(mocks.install).toHaveBeenCalledTimes(1)
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: (value: { installCommand: string }) => void
  mocks.install.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await click('Generate install command')
  await act(async () => resolve({ installCommand: 'install-test-command' }))
  expect(mocks.install).toHaveBeenCalledTimes(2)
  expect(
    document.querySelector('[role="alert"]')?.textContent ?? '',
  ).not.toContain('Unable to connect')
})
test('detail disable requires confirmation and retains errors during retry', async () => {
  const node = await mount(
    <ServerDangerSection server={server} teamSlug="team" />,
  )
  await click('Disable server', node)
  await click('Disable server', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.disable).not.toHaveBeenCalled()
  await confirmName()
  mocks.disable.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await click('Disable server', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: () => void
  mocks.disable.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await click('Disable server', document.querySelector('[role="alertdialog"]')!)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})
test('detail deletion loads inspection, retries failed inspection and guards pending deletion', async () => {
  mocks.inspect.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  const node = await mount(
    <ServerDangerSection server={server} teamSlug="team" />,
  )
  await click('Delete server', node)
  expect(mocks.inspect).toHaveBeenCalledTimes(1)
  mocks.inspect.mockResolvedValueOnce({
    projectCount: 0,
    environmentCount: 0,
  })
  await click('Retry inspection')
  expect(mocks.inspect).toHaveBeenCalledTimes(2)
  await click('Delete server', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.remove).not.toHaveBeenCalled()
  await confirmName()
  mocks.remove.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await click('Delete server', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  let resolve!: () => void
  mocks.remove.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    }),
  )
  await click('Delete server', document.querySelector('[role="alertdialog"]')!)
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await act(async () => resolve())
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})

test('detail enabling uses the enable action and closes after success', async () => {
  const disabled = { ...server, status: 'disabled' as const }
  const node = await mount(
    <ServerDangerSection server={disabled} teamSlug="team" />,
  )
  await click('Enable server', node)
  mocks.enable.mockResolvedValueOnce(undefined)
  await click('Enable server', document.querySelector('[role="alertdialog"]')!)
  expect(mocks.enable).toHaveBeenCalledWith({
    data: { teamSlug: 'team', serverId: 's' },
  })
  expect(mocks.disable).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
})
test('detail closing and reopening ignores the old inspection response', async () => {
  let old!: (value: { projectCount: number; environmentCount: number }) => void
  mocks.inspect
    .mockReturnValueOnce(
      new Promise((done) => {
        old = done
      }),
    )
    .mockResolvedValueOnce({ projectCount: 2, environmentCount: 3 })
  const node = await mount(
    <ServerDangerSection server={server} teamSlug="team" />,
  )
  await click('Delete server', node)
  await click('Cancel', document.querySelector('[role="alertdialog"]')!)
  await click('Delete server', node)
  await act(async () => old({ projectCount: 99, environmentCount: 99 }))
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    '2 projects',
  )
  expect(
    document.querySelector('[role="alertdialog"]')?.textContent,
  ).not.toContain('99')
})

test('server name editing validates inline, locks pending edits, and preserves failed submissions', async () => {
  const details = {
    ...server,
    agentVersion: null,
    agentProtocolVersion: null,
    agentCapabilities: null,
    agentUpdate: {
      status: 'current' as const,
      latestVersion: null,
      reason: null,
    },
    publicAddress: null,
    lastSeenAt: null,
    hostname: null,
    operatingSystem: null,
    kernelVersion: null,
    architecture: null,
    cpuCoreCount: null,
    hostUptimeSeconds: null,
    monitoring: {
      availabilityPercent: null,
      availabilityWindowMs: 86400000,
      latestMetrics: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const node = await mount(
    <ServerDetail
      server={details}
      team={{
        settingsVersion: 1,
        id: 't',
        slug: 'team',
        name: 'Team',
        image: null,
        color: 'lime',
        role: 'owner',
      }}
    />,
  )
  const fill = async (value: string) => {
    await act(async () => {
      const input = node.querySelector('#server-name')!
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const submit = async () => {
    await act(async () =>
      node
        .querySelector('#server-general-form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    )
  }
  await fill('')
  await submit()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(node.querySelector('#server-name-error')?.textContent).toContain(
    'Enter a server name',
  )
  await fill('new-host')
  let reject!: (error: Error) => void
  mocks.update.mockReturnValueOnce(
    new Promise<void>((_, fail) => {
      reject = fail
    }),
  )
  await submit()
  await submit()
  expect(mocks.update).toHaveBeenCalledTimes(1)
  expect(node.querySelector<HTMLInputElement>('#server-name')?.disabled).toBe(
    true,
  )
  await act(async () => reject(new TypeError('Failed to fetch')))
  expect(mocks.error).toHaveBeenLastCalledWith(
    expect.stringContaining('Unable to connect'),
  )
  expect(node.querySelector<HTMLInputElement>('#server-name')?.value).toBe(
    'new-host',
  )
  mocks.update.mockResolvedValueOnce({ settingsVersion: 2 })
  await submit()
  expect(mocks.update).toHaveBeenCalledTimes(2)
  expect(node.querySelector('#server-general-form [role="alert"]')).toBeNull()
})

vi.mock('@/lib/resource-cache', () => ({
  invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))

test.each(['owner', 'member'] as const)(
  'server list shows only the settings action to %s',
  async (role) => {
    const node = await mount(
      <TeamServers
        team={{ ...projectContext.team, role }}
        servers={[
          {
            ...server,
            publicAddress: null,
            lastSeenAt: null,
            agentVersion: null,
            agentUpdate: {
              status: 'current',
              latestVersion: null,
              reason: null,
            },
            monitoring: {
              availabilityPercent: null,
              availabilityWindowMs: 86400000,
              latestMetrics: null,
            },
          },
        ]}
      />,
    )
    const settings = node.querySelector('a[aria-label="Settings for host-1"]')
    if (role === 'owner') {
      expect(settings?.getAttribute('href')).toBe(
        `/${projectContext.team.slug}/servers/s`,
      )
      expect(settings?.getAttribute('data-variant')).toBe('outline')
      expect(settings?.querySelector('.lucide-settings')).not.toBeNull()
    } else expect(settings).toBeNull()
    expect(node.querySelector('[aria-haspopup="menu"]')).toBeNull()
    expect(node.textContent).not.toContain('Delete server')
    expect(node.textContent).not.toContain('Disable server')
  },
)
