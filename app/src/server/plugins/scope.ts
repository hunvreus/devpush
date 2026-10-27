import { AsyncLocalStorage } from 'node:async_hooks'
import type { PluginServices } from '#devpush/plugins/contract'

const scope = new AsyncLocalStorage<{ services?: PluginServices }>()

/** Reuse providers within a request/tick, never across unrelated Worker invocations. */
export function withPluginScope<T>(work: () => T): T {
  return scope.run({}, work)
}

export function scopedPluginServices(
  create: () => PluginServices,
): PluginServices {
  const current = scope.getStore()
  if (!current) return create()
  return (current.services ??= create())
}
