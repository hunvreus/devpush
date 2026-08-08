import { useEffect, useRef } from 'react'

const refreshIntervalMs = 15_000

export function useVisibleRefresh(
  refresh: () => void | Promise<unknown>,
  enabled = true,
) {
  const refreshRef = useRef(refresh)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshRef.current()
      }
    }
    const interval = window.setInterval(refreshIfVisible, refreshIntervalMs)
    document.addEventListener('visibilitychange', refreshIfVisible)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [enabled])
}
