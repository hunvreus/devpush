import { expect, test, vi } from 'vitest'
import { createNodeBroadcaster } from './node-broadcaster'

const auth = { teamId: 'a', sessionId: 's', expiresAt: Date.now() + 60000 }
const peer = (id: string) => ({ id, send: vi.fn(), close: vi.fn() })

test('broadcasts only to the chosen workspace and removes closed connections', async () => {
  const broadcaster = createNodeBroadcaster()
  const a = peer('a'),
    b = peer('b')
  broadcaster.add(a, auth)
  broadcaster.add(b, { ...auth, teamId: 'b' })
  await broadcaster.getByName('a').publish('deployments', ['s'])
  expect(a.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'changed', kind: 'deployments' }),
  )
  expect(b.send).not.toHaveBeenCalled()
  broadcaster.remove(a, 'a')
  await broadcaster.getByName('a').publish('servers', ['s'])
  expect(a.send).toHaveBeenCalledOnce()
})

test('expired and revoked sessions are closed before sending', async () => {
  const broadcaster = createNodeBroadcaster()
  const expired = peer('expired'),
    revoked = peer('revoked')
  broadcaster.add(expired, { ...auth, expiresAt: 0 })
  broadcaster.add(revoked, { ...auth, sessionId: 'revoked' })
  await broadcaster.getByName('a').publish('servers', ['s'])
  for (const socket of [expired, revoked]) {
    expect(socket.send).not.toHaveBeenCalled()
    expect(socket.close).toHaveBeenCalledWith(1008, 'Authorization expired')
  }
  await broadcaster.getByName('a').publish('servers', ['s'])
  expect(expired.close).toHaveBeenCalledOnce()
})

test('broken sockets cannot prevent delivery to other peers', async () => {
  const broadcaster = createNodeBroadcaster()
  const broken = peer('broken'),
    healthy = peer('healthy')
  broken.send.mockImplementation(() => {
    throw new Error('disconnected')
  })
  broadcaster.add(broken, auth)
  broadcaster.add(healthy, auth)
  await broadcaster.getByName('a').publish('logs', ['s'])
  expect(broken.close).toHaveBeenCalledWith(1011, 'Reconnect required')
  expect(healthy.send).toHaveBeenCalledOnce()
})

test('HTTP and WebSocket module copies share the process registry', async () => {
  const first = await import('./node-broadcaster')
  const socket = peer('module-copy')
  first.nodeBroadcaster.add(socket, auth)
  vi.resetModules()
  const second = await import('./node-broadcaster')
  try {
    await second.nodeBroadcaster.getByName('a').publish('servers', ['s'])
    expect(socket.send).toHaveBeenCalledOnce()
  } finally {
    first.nodeBroadcaster.remove(socket, 'a')
  }
})
