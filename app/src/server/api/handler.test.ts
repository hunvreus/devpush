import { beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { apiErrorBody, handlePublicApiRequest } from './handler'
import { publicApiOperations } from './operation-contract'
import { PublicError } from '#devpush/lib/public-error'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  authenticate: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('./credentials', () => ({ authenticateApiKey: mocks.authenticate }))
vi.mock('./operations', () => ({ executeApiOperation: mocks.execute }))
vi.mock('#devpush/server/http/rate-limit', () => ({
  enforceRateLimit: mocks.limit,
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.limit.mockResolvedValue(null)
  mocks.authenticate.mockResolvedValue({ userId: 'u' })
  mocks.execute.mockImplementation(async ({ operationId, input }) => {
    const operation = publicApiOperations.find(
      (entry) => entry.id === operationId,
    )!
    operation.input.parse(input)
    return { data: {}, status: operation.status }
  })
})

test('deleting referenced backup storage returns a conflict response', async () => {
  mocks.execute.mockRejectedValue(new PublicError('BACKUP_STORAGE_IN_USE'))
  const response = await handlePublicApiRequest(
    new Request('https://example.test/api/v1/backup-storage/storage', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'storage-delete',
      },
      body: JSON.stringify({ confirmation: 'delete-storage' }),
    }),
  )
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    error: { code: 'BACKUP_STORAGE_IN_USE' },
  })
})

test.each(['__proto__', 'constructor', 'unexpected'])(
  'query parameter %s is preserved for strict input validation',
  async (name) => {
    const response = await handlePublicApiRequest(
      new Request(`https://example.test/api/v1/projects?${name}=supplied`),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    })
  },
)

test('duplicate prototype-named query parameters are rejected before execution', async () => {
  const response = await handlePublicApiRequest(
    new Request(
      'https://example.test/api/v1/projects?__proto__=one&__proto__=two',
    ),
  )
  expect(response.status).toBe(400)
  expect(mocks.execute).not.toHaveBeenCalled()
})

test('JSON prototype keys cannot disappear before strict body validation', async () => {
  const response = await handlePublicApiRequest(
    new Request('https://example.test/api/v1/projects/project', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'attempt-1',
      },
      body: '{"name":"new-name","revision":"2026-10-13T00:00:00.000Z","__proto__":{"unexpected":true}}',
    }),
  )
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({
    error: { code: 'INVALID_INPUT' },
  })
})

test('prototype-named validation paths produce safe serializable field errors', () => {
  const error = new z.ZodError([
    { code: 'custom', path: ['__proto__'], message: 'private diagnostic' },
  ])
  const body = apiErrorBody(error, 'request-1')
  expect(JSON.parse(JSON.stringify(body))).toEqual({
    error: {
      code: 'INVALID_INPUT',
      message: 'Check the entered values and try again.',
      requestId: 'request-1',
      fieldErrors: { ['__proto__']: ['Invalid value.'] },
    },
  })
})
