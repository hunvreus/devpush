import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import { AsyncLocalStorage } from 'node:async_hooks'

type Defer = (promise: Promise<unknown>) => void
const scope = new AsyncLocalStorage<Defer>()

export function withBackgroundTasks<T>(defer: Defer, work: () => T): T {
  return scope.run(defer, work)
}
/** Workers keep the task alive with waitUntil; Node runs it independently of the response. */
export function deferBackgroundTask(work: () => Promise<unknown>) {
  const pending = Promise.resolve()
    .then(work)
    .catch((error: unknown) => {
      console.warn(
        'Background task failed; persisted work will be retried.',
        safeErrorDiagnostics(error),
      )
    })
  scope.getStore()?.(pending)
}
