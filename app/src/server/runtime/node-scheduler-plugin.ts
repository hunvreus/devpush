import { withPluginScope } from '#devpush/server/plugins/scope'
import { definePlugin } from 'nitro'
import { assertRuntimeSecurity, config } from '#devpush/server/config'
import { withDatabaseScope } from '#devpush/server/db'
import { runScheduledTasks } from '#devpush/server/scheduled-tasks'
import { startNodeScheduler } from './node-scheduler'

export default definePlugin((app) => {
  if (process.env.NODE_ENV !== 'production') return
  assertRuntimeSecurity(config)
  const stop = startNodeScheduler((maintenance) =>
    withPluginScope(() =>
      withDatabaseScope(() => runScheduledTasks(maintenance)),
    ),
  )
  app.hooks.hook('close', stop)
})
