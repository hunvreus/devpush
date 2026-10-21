import { expect, test, vi } from 'vitest'
import {
  isClientDisconnect,
  clientDisconnectPlugin,
} from '../../dev/client-disconnect'

test('recognizes a reset only after the client disconnects', () => {
  const reset = Object.assign(new Error('read ECONNRESET'), {
    code: 'ECONNRESET',
  })
  expect(
    isClientDisconnect(reset, { aborted: true }, { destroyed: false }),
  ).toBe(true)
  expect(
    isClientDisconnect(
      new Error('request failed', { cause: reset }),
      { aborted: false },
      { destroyed: true },
    ),
  ).toBe(true)
  expect(
    isClientDisconnect(reset, { aborted: false }, { destroyed: false }),
  ).toBe(false)
})

test('preserves application errors even after disconnect and handles cyclic causes', () => {
  const error = new Error('application failure')
  expect(
    isClientDisconnect(error, { aborted: true }, { destroyed: true }),
  ).toBe(false)
  Object.assign(error, { cause: error })
  expect(
    isClientDisconnect(error, { aborted: true }, { destroyed: true }),
  ).toBe(false)
})

test('agent transport resets return 502 without broadcasting an HMR error', () => {
  let middleware: (...args: any[]) => void
  const logger = { error: vi.fn() }
  const plugin = clientDisconnectPlugin()
  const install = (plugin.configureServer as (server: unknown) => () => void)({
    config: { logger },
    middlewares: {
      use: (handler: typeof middleware) => {
        middleware = handler
      },
    },
  })
  install()
  const reset = Object.assign(new Error('read ECONNRESET'), {
    code: 'ECONNRESET',
  })
  const response = {
    destroyed: false,
    headersSent: false,
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  }
  const next = vi.fn()
  middleware!(
    reset,
    {
      aborted: false,
      method: 'POST',
      url: '/api/agents/jobs/next?private=query',
    },
    response,
    next,
  )
  expect(response.statusCode).toBe(502)
  expect(JSON.parse(response.end.mock.calls[0]![0]).error).toContain(
    'connection reset',
  )
  expect(next).not.toHaveBeenCalled()
  expect(logger.error.mock.calls[0]![0]).toContain('POST /api/agents/jobs/next')
  expect(logger.error.mock.calls[0]![0]).not.toContain('private')
  middleware!(
    reset,
    { aborted: false, method: 'GET', url: '/project' },
    response,
    next,
  )
  expect(next).toHaveBeenCalledWith(reset)
  next.mockClear()
  const applicationError = new Error('query failed')
  middleware!(
    applicationError,
    { aborted: false, method: 'POST', url: '/api/agents/jobs/next' },
    response,
    next,
  )
  expect(next).toHaveBeenCalledWith(applicationError)
})
