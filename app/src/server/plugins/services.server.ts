import { scopedPluginServices } from './scope'
import plugins from '#devpush/plugins/registered-server'
import { pluginContext } from './server-context'
import { composeServerPlugins } from '#devpush/plugins/server'

export function getPluginServices() {
  return scopedPluginServices(() =>
    composeServerPlugins(plugins, process.env, pluginContext),
  )
}
