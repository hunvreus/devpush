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
    const request = new Request('https://devpush.test/api/test', {
      method: 'POST',
      body: 'hello!',
    })

    await expect(readRequestText(request, 5)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
  })
})
