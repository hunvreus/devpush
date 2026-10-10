import { expect, test, vi } from 'vitest'
import { agentEventKind, notifyAgentMutation } from './agent-events'
import { notifyServer } from './service'

vi.mock('./service', () => ({ notifyServer: vi.fn() }))

test('empty job polling and status reads do not broadcast', () => {
  expect(agentEventKind('/api/agents/jobs/next', { job: null })).toBeNull()
  expect(agentEventKind('/api/agents/jobs/status', {})).toBeNull()
  expect(agentEventKind('/api/agents/jobs/next', { job: { id: 'd' } })).toBe(
    'deployments',
  )
})
test('only successful mutation payloads identify the server to notify', async () => {
  await notifyAgentMutation(
    '/api/agents/register',
    { token: 'secret' },
    { serverId: 's' },
  )
  expect(notifyServer).toHaveBeenCalledWith('s', 'servers')
})
