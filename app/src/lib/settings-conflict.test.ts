import { afterEach, expect, test, vi } from 'vitest'
import { PublicError } from './public-error'
import { showSettingsConflict } from './settings-conflict'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
  confirm: vi.fn(),
  assign: vi.fn(),
  reload: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.error, dismiss: mocks.dismiss },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

test('only stale settings produce the persistent toast; Reload confirms before discarding drafts', () => {
  vi.stubGlobal('window', {
    confirm: mocks.confirm,
    location: { reload: mocks.reload, assign: mocks.assign },
  })
  expect(showSettingsConflict(new PublicError('FORBIDDEN'))).toBe(false)
  expect(
    showSettingsConflict({ name: 'PublicError', code: 'SETTINGS_CONFLICT' }),
  ).toBe(true)
  const options = mocks.error.mock.calls[0]![1]
  expect(options).toMatchObject({
    id: 'settings-conflict',
    duration: Infinity,
    closeButton: false,
    cancel: { label: 'Dismiss' },
    action: { label: 'Reload' },
  })
  expect(mocks.error.mock.calls[0]![0]).toBe('Your changes weren’t saved.')
  expect(options.description).toBe(
    'Settings have changed since you started editing. Reload to load the latest settings.',
  )
  options.cancel.onClick()
  expect(mocks.dismiss).toHaveBeenCalledWith('settings-conflict')
  expect(mocks.reload).not.toHaveBeenCalled()
  mocks.confirm.mockReturnValueOnce(false)
  options.action.onClick()
  expect(mocks.reload).not.toHaveBeenCalled()
  expect(mocks.error).toHaveBeenCalledTimes(2)
  mocks.confirm.mockReturnValueOnce(true)
  options.action.onClick()
  expect(mocks.reload).toHaveBeenCalledTimes(1)
})

test('Reload follows the server-provided current URL after a concurrent rename', () => {
  vi.stubGlobal('window', {
    confirm: mocks.confirm,
    location: { reload: mocks.reload, assign: mocks.assign },
  })
  mocks.confirm.mockReturnValueOnce(true)
  showSettingsConflict(
    new PublicError('SETTINGS_CONFLICT', '/team/projects/renamed/settings'),
  )
  mocks.error.mock.calls[0]![1].action.onClick()
  expect(mocks.assign).toHaveBeenCalledWith('/team/projects/renamed/settings')
  expect(mocks.reload).not.toHaveBeenCalled()
})
