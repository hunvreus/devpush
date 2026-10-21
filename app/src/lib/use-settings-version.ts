import { useEffect, useRef } from 'react'

// Clean forms adopt an authoritative snapshot. Dirty forms keep the version
// they started from, so a refresh cannot silently turn a stale draft into a save.
export function useSettingsVersion({
  version,
  dirty,
  saving,
  refresh,
}: {
  version: number
  dirty: boolean
  saving: boolean
  refresh: () => void
}) {
  const originalVersion = useRef(version)
  useEffect(() => {
    if (dirty || saving || version <= originalVersion.current) return
    originalVersion.current = version
    refresh()
  }, [version, dirty, saving, refresh])
  return originalVersion
}
