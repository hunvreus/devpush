// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { AccountEmailPreferences, NotificationMute } from './email-preferences'
import { defaultNotificationPreferences } from '#devpush/lib/notification-preferences'

const mocks = vi.hoisted(() => ({ save: vi.fn(), mute: vi.fn() }))
vi.mock('#devpush/server/notifications/functions', () => ({
  getNotificationPreferences: async () => ({
    preferences: {
      deployments: true,
      backups: true,
      domains: true,
      servers: true,
    },
    version: 0,
  }),
  updateNotificationPreferences: mocks.save,
  getNotificationMute: async () => ({ muted: false }),
  updateNotificationMute: mocks.mute,
}))
vi.mock('#devpush/features/plugins/contributions', () => ({
  useEmailPreferenceContributions: () => ({
    fields: null,
    dirty: false,
    pending: false,
    save: async () => {},
    reset: () => {},
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount(mute = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['notification-preferences', 'user'], {
    preferences: defaultNotificationPreferences,
    version: 0,
  })
  client.setQueryData(['notification-mute', 'workspace', 'workspace'], {
    muted: false,
  })
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {mute ? (
          <NotificationMute scope={{ kind: 'workspace', id: 'workspace' }} />
        ) : (
          <AccountEmailPreferences userId="user" />
        )}
      </QueryClientProvider>,
    )
  })
  return {
    node,
    close: async () => {
      await act(async () => root.unmount())
      node.remove()
      client.clear()
    },
  }
}
async function click(element: Element | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}
test('checkbox changes are drafts until Save, and Cancel restores saved values', async () => {
  const view = await mount()
  const checkbox = view.node.querySelector('[role=checkbox]')!
  await click(checkbox)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(checkbox.getAttribute('aria-checked')).toBe('false')
  await click(
    [...view.node.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    )!,
  )
  expect(checkbox.getAttribute('aria-checked')).toBe('true')
  expect(mocks.save).not.toHaveBeenCalled()
  await view.close()
})
test('Save persists category changes and prevents duplicate submissions while pending', async () => {
  const view = await mount()
  let finish!: (value: unknown) => void
  mocks.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await click(view.node.querySelector('[role=checkbox]'))
  const form = view.node.querySelector('form')!
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(
    view.node.querySelector('[role=checkbox]')?.hasAttribute('disabled'),
  ).toBe(true)
  expect(view.node.querySelector('svg.animate-spin')).not.toBeNull()
  await act(async () =>
    finish({
      preferences: { ...defaultNotificationPreferences, deployments: false },
      version: 1,
    }),
  )
  expect(
    view.node.querySelector('button[type=submit]')?.hasAttribute('disabled'),
  ).toBe(true)
  await view.close()
})
test('workspace mute saves immediately and prevents duplicate changes while pending', async () => {
  const view = await mount(true)
  let finish!: (value: unknown) => void
  mocks.mute.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const toggle = view.node.querySelector('[role=switch]')!
  await click(toggle)
  expect(mocks.mute).toHaveBeenCalledWith({
    data: { scope: { kind: 'workspace', id: 'workspace' }, muted: true },
  })
  expect(toggle.hasAttribute('disabled')).toBe(true)
  expect(
    view.node.querySelector('[aria-label="Saving notification preference"]'),
  ).toBeNull()
  expect(view.node.textContent).not.toContain('Cancel')
  await act(async () => finish({ muted: true }))
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await view.close()
})
test('failed mute saves restore the saved switch value', async () => {
  const view = await mount(true)
  mocks.mute.mockRejectedValue(new Error('offline'))
  const toggle = view.node.querySelector('[role=switch]')!
  await click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(toggle.hasAttribute('disabled')).toBe(false)
  await view.close()
})
