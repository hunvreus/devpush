import { useEffect, useSyncExternalStore } from 'react'

export type DeferredModule<T> = ReturnType<typeof createDeferredModule<T>>

// Pending views can reuse an already-loaded page without pulling that page into
// every route. A skeleton remains available while its module loads.
export function createDeferredModule<T>(importModule: () => Promise<T>) {
  let value: T | undefined
  let pending: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const load = () => {
    if (value !== undefined) return Promise.resolve()
    return (pending ??= importModule().then(
      (result) => {
        value = result
        for (const listener of listeners) listener()
      },
      () => {
        pending = undefined
      },
    ))
  }
  function useModule(enabled: boolean) {
    const module = useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => value,
      () => undefined,
    )
    useEffect(() => {
      if (enabled) void load()
    }, [enabled])
    return module
  }
  return { load, useModule }
}
