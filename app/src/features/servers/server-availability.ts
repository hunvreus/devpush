import type { ServerSummary } from '@/server/teams/service'

export function getServerAvailabilityNotice(
  servers: Array<Pick<ServerSummary, 'id' | 'name' | 'status'>>,
): {
  title: string
  description: string
  targetServerId: string
} | null {
  const disconnected = servers.filter(
    (server) => server.status === 'disconnected',
  )
  const target = disconnected.at(0)
  if (!target) {
    return null
  }

  const names = disconnected.map((server) => server.name)
  return {
    title: `${disconnected.length} ${disconnected.length === 1 ? 'server is' : 'servers are'} disconnected`,
    description:
      names.length <= 2
        ? `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} disconnected.`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more are disconnected.`,
    targetServerId: target.id,
  }
}
