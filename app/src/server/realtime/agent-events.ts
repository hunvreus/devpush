import { notifyServer } from './service'

export function agentEventKind(path: string, result: unknown) {
  if (path === '/api/agents/heartbeat' || path === '/api/agents/register')
    return 'servers' as const
  if (path === '/api/agents/runtime-logs') return 'logs' as const
  if (path === '/api/agents/jobs/next') {
    return result && typeof result === 'object' && 'job' in result && result.job
      ? ('deployments' as const)
      : null
  }
  if (['/api/agents/jobs/progress', '/api/agents/jobs/complete'].includes(path))
    return 'deployments' as const
  return null
}

export async function notifyAgentMutation(
  path: string,
  payload: unknown,
  result: unknown,
) {
  const kind = agentEventKind(path, result)
  if (!kind) return
  const source = path === '/api/agents/register' ? result : payload
  if (
    source &&
    typeof source === 'object' &&
    'serverId' in source &&
    typeof source.serverId === 'string'
  )
    await notifyServer(source.serverId, kind)
}
