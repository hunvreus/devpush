import { afterEach, expect, test, vi } from 'vitest'
import {
  afterMutation,
  copyText,
  mutationErrorOptions,
  refreshView,
} from './action-feedback'
import { PublicError } from './public-error'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('sonner', () => ({ toast }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
test('actionable errors remain until dismissed, while ordinary errors keep default timing', () => {
  const error = new PublicError('WORKSPACE_RESTRICTED', undefined, {
    message: 'Workspace is restricted.',
    recoveryUrl: '/team/settings#billing',
  })
  expect(mutationErrorOptions(error)).toEqual([
    expect.objectContaining({
      duration: Infinity,
      closeButton: true,
      action: expect.objectContaining({ label: 'Review settings' }),
    }),
  ])
  expect(mutationErrorOptions(new Error('offline'))).toEqual([])
})
test('does not claim clipboard success after denied permission', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  })
  expect(await copyText('invite-url', 'Invite link')).toBe(false)
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining('Unable to copy invite link'),
  )
})
test('handles browsers without clipboard access', async () => {
  vi.stubGlobal('navigator', {})
  expect(await copyText('id', 'Server ID')).toBe(false)
})
test('acknowledges copying only after it completes', async () => {
  let finish!: () => void
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    },
  })
  const result = copyText('id', 'Server ID')
  expect(toast.success).not.toHaveBeenCalled()
  finish()
  expect(await result).toBe(true)
  expect(toast.success).toHaveBeenCalledWith('Server ID copied.')
})
test('reports a failed follow-up separately from the completed mutation', async () => {
  expect(
    await afterMutation(
      () => Promise.reject(new Error('database details')),
      'Saved, but refresh failed.',
    ),
  ).toBe(false)
  expect(toast.warning).toHaveBeenCalledWith('Saved, but refresh failed.')
  expect(toast.error).not.toHaveBeenCalled()
})
test('waits for navigation before completing a follow-up', async () => {
  let finish!: () => void
  let done = false
  const task = afterMutation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    'Unable to navigate.',
  ).then(() => {
    done = true
  })
  await Promise.resolve()
  expect(done).toBe(false)
  finish()
  await task
  expect(done).toBe(true)
})
test('keeps one identified refresh warning and clears it after recovery', async () => {
  await refreshView(() => Promise.reject(new Error('offline')), 'logs')
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining('out of date'),
    { id: 'logs' },
  )
  await refreshView(() => Promise.resolve(), 'logs')
  expect(toast.dismiss).toHaveBeenCalledWith('logs')
})
