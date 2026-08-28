import { describe, expect, test } from 'vitest'

import { RequestBodyTooLargeError, readRequestText } from './request-body'

describe('readRequestText', () => {
  test('reads request bodies within the configured limit', async () => {
    const request = new Request('https://devpush.test/api/test', {
      method: 'POST',
      body: 'hello',
    })

    await expect(readRequestText(request, 5)).resolves.toBe('hello')
  })

  test('rejects a declared body larger than the configured limit', async () => {
    const request = new Request('https://devpush.test/api/test', {
      method: 'POST',
      headers: { 'content-length': '6' },
      body: 'x',
    })

    await expect(readRequestText(request, 5)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
  })

  test('rejects a streamed body larger than the configured limit', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('hel'))
        controller.enqueue(encoder.encode('lo!'))
        controller.close()
      },
    })
    const request = new Request('https://devpush.test/api/test', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    expect(request.headers.has('content-length')).toBe(false)

    await expect(readRequestText(request, 5)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
  })
})
