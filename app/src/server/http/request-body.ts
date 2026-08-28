export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds the ${maxBytes} byte limit.`)
    this.name = 'RequestBodyTooLargeError'
  }
}

export async function readRequestText(request: Request, maxBytes: number) {
  const declaredLength = request.headers.get('content-length')

  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maxBytes
  ) {
    await request.body?.cancel().catch(() => undefined)
    throw new RequestBodyTooLargeError(maxBytes)
  }

  if (!request.body) {
    return ''
  }

  const reader = request.body.getReader()
  const chunks: Array<Uint8Array> = []
  let totalBytes = 0

  try {
    for (
      let result = await reader.read();
      !result.done;
      result = await reader.read()
    ) {
      const { value } = result
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestBodyTooLargeError(maxBytes)
      }

      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(body)
}
