import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import { ScheduledTaskError } from './scheduled-task-error'
/** One minute-aligned timer, with no overlapping runs and retry after failure. */
export function startNodeScheduler(
  run: (maintenance: boolean) => Promise<void>,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastMaintenanceHour: number | undefined
  let active: Promise<void> = Promise.resolve()
  function schedule() {
    if (stopped) return
    timer = setTimeout(
      () => {
        const hour = Math.floor(Date.now() / 3_600_000)
        const maintenance = hour !== lastMaintenanceHour
        active = Promise.resolve()
          .then(() => run(maintenance))
          .then(() => {
            if (maintenance) lastMaintenanceHour = hour
          })
          .catch((error: unknown) => {
            if (
              maintenance &&
              error instanceof ScheduledTaskError &&
              error.maintenanceCompleted
            )
              lastMaintenanceHour = hour
            console.error(
              'Scheduled tasks failed; retrying on the next minute tick.',
              {
                errors: (error instanceof AggregateError
                  ? error.errors.slice(0, 4)
                  : [error]
                ).map(safeErrorDiagnostics),
              },
            )
          })
          .finally(schedule)
      },
      60_000 - (Date.now() % 60_000),
    )
    timer.unref()
  }
  schedule()
  return async () => {
    stopped = true
    clearTimeout(timer)
    await active
  }
}
