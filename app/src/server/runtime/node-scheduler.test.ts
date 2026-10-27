import { ScheduledTaskError } from './scheduled-task-error'
import { afterEach, expect, test, vi } from 'vitest'
import { startNodeScheduler } from './node-scheduler'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
test('runs on minute boundaries, retries failures and runs maintenance once per successful hour', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T10:00:30Z'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const run = vi
    .fn()
    .mockRejectedValueOnce(new Error('temporary'))
    .mockResolvedValue(undefined)
  const stop = startNodeScheduler(run)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(run).toHaveBeenLastCalledWith(true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(run).toHaveBeenLastCalledWith(true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(run).toHaveBeenLastCalledWith(false)
  await vi.advanceTimersByTimeAsync(57 * 60_000)
  expect(run).toHaveBeenLastCalledWith(true)
  await stop()
  const count = run.mock.calls.length
  await vi.advanceTimersByTimeAsync(120_000)
  expect(run).toHaveBeenCalledTimes(count)
})
test('does not overlap work and waits for an active run on shutdown', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const stop = startNodeScheduler(run)
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.advanceTimersByTimeAsync(180_000)
  expect(run).toHaveBeenCalledTimes(1)
  let stopped = false
  const shutdown = stop().then(() => {
    stopped = true
  })
  expect(stopped).toBe(false)
  finish()
  await shutdown
  await vi.advanceTimersByTimeAsync(60_000)
  expect(run).toHaveBeenCalledTimes(1)
})

test('synchronous task failures still schedule the next tick', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const run = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('sync failure')
    })
    .mockResolvedValue(undefined)
  const stop = startNodeScheduler(run)
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(run).toHaveBeenCalledTimes(2)
  await stop()
})

test('a failed minute task does not repeat successful hourly maintenance', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const run = vi
    .fn()
    .mockRejectedValueOnce(
      new ScheduledTaskError([new Error('notifications')], true),
    )
    .mockResolvedValue(undefined)
  const stop = startNodeScheduler(run)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(run).toHaveBeenLastCalledWith(true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(run).toHaveBeenLastCalledWith(false)
  await stop()
})
