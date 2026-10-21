import { afterEach, expect, test, vi } from 'vitest'
import { ZodError } from 'zod'
import { PublicError } from '@/lib/public-error'
import { publicErrorPayload, toPublicError } from './public-errors'

afterEach(() => vi.restoreAllMocks())

test('unexpected server failures are logged and never sent to the client', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const original = new Error('provider diagnostics and SQL query')
  const result = toPublicError(original)
  expect(result.code).toBe('INTERNAL_ERROR')
  expect(result.message).not.toContain('SQL')
  expect(result.cause).toBeUndefined()
  expect(log).toHaveBeenCalledWith('Server action failed', original)
})

test('expected errors retain their code and input/access failures have safe messages', () => {
  const error = new PublicError('SERVER_DISABLED_ENROLLMENT')
  expect(toPublicError(error)).toBe(error)
  expect(toPublicError(new ZodError([])).code).toBe('INVALID_INPUT')
  expect(toPublicError(new Error('Forbidden')).code).toBe('FORBIDDEN')
  expect(toPublicError(new Error('Sign in before adding a server.')).code).toBe(
    'UNAUTHORIZED',
  )
})

test('rate limiting remains actionable without forwarding diagnostics', () => {
  expect(
    toPublicError({ statusCode: 429, message: 'private limiter details' }).code,
  ).toBe('RATE_LIMITED')
})

test('transport payload contains only registered public information', () => {
  const error = new PublicError(
    'SETTINGS_CONFLICT',
    '/team/projects/project/settings',
  )
  Object.assign(error, {
    cause: new Error('private cause'),
    privateSecret: 'never send',
  })
  expect(publicErrorPayload(error)).toEqual({
    name: 'PublicError',
    code: 'SETTINGS_CONFLICT',
    message: error.message,
    reloadUrl: '/team/projects/project/settings',
  })
})
