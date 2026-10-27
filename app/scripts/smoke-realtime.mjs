import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { request } from 'node:http'

/** Authenticate a real WebSocket upgrade and exercise the agent-update transport. */
export async function smokeRealtime({ origin, teamSlug, cookie }) {
  const key = randomBytes(16).toString('base64')
  const expected = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')
  await new Promise((resolve, reject) => {
    let socket
    let complete = false
    const upgrade = request(
      `${origin}/api/workspaces/updates?team=${encodeURIComponent(teamSlug)}`,
      {
        headers: {
          origin,
          cookie,
          upgrade: 'websocket',
          connection: 'Upgrade',
          'sec-websocket-version': '13',
          'sec-websocket-key': key,
        },
      },
    )
    const timer = setTimeout(
      () => finish(new Error('Workspace WebSocket timed out')),
      10000,
    )
    function finish(error) {
      if (complete) return
      complete = true
      clearTimeout(timer)
      socket?.destroy()
      upgrade.destroy()
      if (error) reject(error)
      else resolve()
    }
    upgrade.once('error', finish)
    upgrade.once('response', (response) => {
      response.resume()
      finish(
        new Error(
          `Workspace WebSocket upgrade returned ${response.statusCode}`,
        ),
      )
    })
    upgrade.once('upgrade', (response, connection, head) => {
      socket = connection
      try {
        assert.equal(response.headers['sec-websocket-accept'], expected)
      } catch (error) {
        finish(error)
        return
      }
      let pending = head
      function read(chunk) {
        pending = Buffer.concat([pending, chunk])
        if (pending.length < 2) return
        const length = pending[1] & 0x7f
        if (pending.length < length + 2) return
        try {
          assert.equal(pending[0] & 0x0f, 1, 'Expected a text response')
          assert.equal(pending.subarray(2, length + 2).toString(), 'pong')
          finish()
        } catch (error) {
          finish(error)
        }
      }
      socket.on('data', read)
      socket.once('error', finish)
      socket.once('close', () =>
        finish(new Error('Workspace WebSocket closed before pong')),
      )
      const mask = randomBytes(4)
      const payload = Buffer.from('ping')
      for (let index = 0; index < payload.length; index++)
        payload[index] ^= mask[index % 4]
      socket.write(
        Buffer.concat([
          Buffer.from([0x81, 0x80 | payload.length]),
          mask,
          payload,
        ]),
      )
      if (pending.length) read(Buffer.alloc(0))
    })
    upgrade.end()
  })
  console.log(
    'Workspace WebSocket: authenticated upgrade and ping/pong passed.',
  )
}
