import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { waitForAgentJob } from './job-wait'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('empty long polls remain bounded and avoid a duplicate check at the deadline', async () => {
  const claim = vi.fn().mockResolvedValue(null)
  const result = waitForAgentJob(claim, 20, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await result).toBeNull()
  expect(claim).toHaveBeenCalledTimes(4)
  expect(vi.getTimerCount()).toBe(0)
})

test('new work is returned at the next five-second check', async () => {
  const claim = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'job' })
  const result = waitForAgentJob(claim, 20, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(5000)
  expect(await result).toEqual({ id: 'job' })
  expect(claim).toHaveBeenCalledTimes(2)
})

test('each attempt can reject revoked credentials instead of reusing authorization', async () => {
  const claim = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('Server disabled'))
  const result = waitForAgentJob(claim, 20, new AbortController().signal)
  const rejected = expect(result).rejects.toThrow('Server disabled')
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
})

test('disconnects cancel the wait and prevent later claims', async () => {
  const controller = new AbortController()
  const claim = vi.fn().mockResolvedValue(null)
  const result = waitForAgentJob(claim, 20, controller.signal)
  await vi.advanceTimersByTimeAsync(1)
  controller.abort()
  expect(await result).toBeNull()
  expect(claim).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

test('clients requesting no wait keep single-attempt behavior', async () => {
  const claim = vi.fn().mockResolvedValue(null)
  expect(
    await waitForAgentJob(claim, 0, new AbortController().signal),
  ).toBeNull()
  expect(claim).toHaveBeenCalledTimes(1)
})
