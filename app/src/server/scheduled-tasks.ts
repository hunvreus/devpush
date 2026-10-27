import { ScheduledTaskError } from '#devpush/server/runtime/scheduled-task-error'
import { maintainOperationalNotifications } from '#devpush/server/notifications/observe'
import { config } from '#devpush/server/config'
import { queueDueBackupSchedules } from '#devpush/server/backups/service'
import { runMaintenance } from '#devpush/server/maintenance'

/** Shared by the Node timer and Cloudflare scheduled handler. */
export async function runScheduledTasks(maintenance: boolean) {
  const tasks: Array<{ name: string; run: () => Promise<unknown> }> = [
    { name: 'notifications', run: maintainOperationalNotifications },
    ...(config.DEVPUSH_BACKUPS_ENABLED
      ? [{ name: 'backups', run: queueDueBackupSchedules }]
      : []),
    ...(maintenance ? [{ name: 'maintenance', run: runMaintenance }] : []),
  ]
  const results = await Promise.allSettled(
    tasks.map((task) => Promise.resolve().then(() => task.run())),
  )
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length)
    throw new ScheduledTaskError(
      failures.map((result) => result.reason),
      tasks.some(
        (task, index) =>
          task.name === 'maintenance' && results[index]?.status === 'fulfilled',
      ),
    )
}
