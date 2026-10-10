import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  matchesWorkspaceUpdate,
  setWorkspaceConnected,
} from '@/lib/workspace-updates'
import type { UpdateKind } from '@/lib/workspace-updates'

export function useWorkspaceUpdates(teamSlug: string) {
  const client = useQueryClient()
  useEffect(() => {
    let disposed = false
    let available = false
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    let batch: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const pending = new Set<UpdateKind>()
    const url = new URL('/api/workspaces/updates', location.origin)
    url.searchParams.set('team', teamSlug)
    const refresh = (kind?: UpdateKind) =>
      void client.invalidateQueries(
        {
          predicate: (query) =>
            matchesWorkspaceUpdate(query.queryKey, teamSlug, kind),
        },
        { cancelRefetch: false },
      )
    const disconnect = () => {
      clearTimeout(retry)
      clearInterval(ping)
      const previous = socket
      socket = undefined
      previous?.close()
      setWorkspaceConnected(teamSlug, false)
    }
    const connect = () => {
      if (disposed || document.hidden || !available || socket) return
      const target = new URL(url)
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
      const current = new WebSocket(target)
      socket = current
      let lastPong = Date.now()
      let openedAt = Date.now()
      current.onopen = () => {
        if (socket !== current || disposed) return current.close()
        attempts = 0
        openedAt = Date.now()
        setWorkspaceConnected(teamSlug, true)
        refresh()
        ping = setInterval(() => {
          // Renew authentication and detect silently dropped proxy connections.
          if (Date.now() - lastPong > 60_000 || Date.now() - openedAt > 300_000)
            current.close()
          else if (current.readyState === WebSocket.OPEN) current.send('ping')
        }, 25_000)
      }
      current.onmessage = (event) => {
        if (disposed || socket !== current) return
        if (event.data === 'pong') {
          lastPong = Date.now()
          return
        }
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string
            kind?: UpdateKind
          }
          if (
            message.type !== 'changed' ||
            !message.kind ||
            !['deployments', 'servers', 'logs'].includes(message.kind)
          )
            return
          pending.add(message.kind)
          if (!batch)
            batch = setTimeout(() => {
              batch = undefined
              for (const kind of pending) refresh(kind)
              pending.clear()
            }, 250)
        } catch {
          /* Ignore malformed notifications; recovery polling remains active. */
        }
      }
      current.onclose = () => {
        if (socket !== current) return
        socket = undefined
        clearInterval(ping)
        setWorkspaceConnected(teamSlug, false)
        refresh()
        if (!disposed && !document.hidden)
          retry = setTimeout(
            connect,
            Math.min(30_000, 1_000 * 2 ** attempts++) + Math.random() * 500,
          )
      }
      current.onerror = () => current.close()
    }
    const visibility = () => {
      if (document.hidden) disconnect()
      else {
        refresh()
        connect()
      }
    }
    document.addEventListener('visibilitychange', visibility)
    const abort = new AbortController()
    void fetch(url, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return
        const capability = (await response.json()) as { available?: boolean }
        available = capability.available === true
        connect()
      })
      .catch(() => {})
    return () => {
      disposed = true
      abort.abort()
      disconnect()
      clearTimeout(batch)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [client, teamSlug])
}
