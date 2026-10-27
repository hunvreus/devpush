import { expect, test, vi } from 'vitest'
import { deferBackgroundTask, withBackgroundTasks } from './background'

test('background delivery is registered with Worker waitUntil without delaying the response', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const tasks: Promise<unknown>[] = []
  const response = await withBackgroundTasks(
    (task) => tasks.push(task),
    async () => {
      deferBackgroundTask(() => pending)
      return 'response'
    },
  )
  expect(response).toBe('response')
  expect(tasks).toHaveLength(1)
  finish()
  await Promise.all(tasks)
})
test('request deferral contexts stay isolated and background errors do not fail requests', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const first: Promise<unknown>[] = [],
    second: Promise<unknown>[] = []
  await Promise.all([
    withBackgroundTasks(
      (task) => first.push(task),
      async () => {
        await Promise.resolve()
        deferBackgroundTask(async () => {
          throw new Error('private detail')
        })
      },
    ),
    withBackgroundTasks(
      (task) => second.push(task),
      async () => {
        deferBackgroundTask(async () => {})
      },
    ),
  ])
  await Promise.all([...first, ...second])
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  expect(warning).toHaveBeenCalledWith(
    'Background task failed; persisted work will be retried.',
    expect.objectContaining({ errorName: 'Error' }),
  )
  expect(JSON.stringify(warning.mock.calls)).not.toContain('private detail')
  warning.mockRestore()
})
