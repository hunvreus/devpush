import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { config } from '@/server/config'
import { ApiError } from './errors'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  context: z.string(),
  position: z.number().int().nonnegative(),
  id: z.string().max(256),
})

export function encodeApiCursor(context: string, position: number, id = '') {
  const payload = Buffer.from(
    JSON.stringify({ version: 1, context, position, id }),
  ).toString('base64url')
  return `${payload}.${signature(payload)}`
}

export function decodeApiCursor(cursor: string | undefined, context: string) {
  if (!cursor) return null
  try {
    if (cursor.length > 2048) throw new Error('length')
    const [payload, signed, extra] = cursor.split('.')
    if (!payload || !signed || extra) throw new Error('format')
    const expected = Buffer.from(signature(payload))
    const actual = Buffer.from(signed)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error('signature')
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    )
    if (value.context !== context) throw new Error('context')
    return value
  } catch {
    throw new ApiError('INVALID_CURSOR', 400)
  }
}

export function apiFingerprint(value: unknown) {
  return createHmac('sha256', fingerprintKey())
    .update('devpush-api-fingerprint-v1\0')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}

function signature(value: string) {
  return createHmac('sha256', fingerprintKey())
    .update('devpush-api-cursor-v1\0')
    .update(value)
    .digest('base64url')
}

function fingerprintKey() {
  const value = config.DEVPUSH_SECRET_ENCRYPTION_KEY
  if (!value)
    throw new Error(
      'DEVPUSH_SECRET_ENCRYPTION_KEY is required for API cursor and replay protection.',
    )
  return value
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}
