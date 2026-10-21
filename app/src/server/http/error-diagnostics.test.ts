import { expect, test } from 'vitest'
import { safeErrorDiagnostics } from './error-diagnostics'

test('keeps bounded source locations and operation frames without diagnostic messages', () => {
  const error = new Error('SQL contains a private API key')
  error.stack = `Error: ${error.message}\n    at async execute (file:///workspace/app/src/server/api/operations.ts:12:34)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at /workspace/app/src/server/api/handler.ts:56:7`
  expect(safeErrorDiagnostics(error)).toEqual({
    errorName: 'Error',
    stackFrames: [
      'at async execute (src/server/api/operations.ts:12:34)',
      'at processTicksAndRejections (node:internal/process/task_queues:105:5)',
      'at src/server/api/handler.ts:56:7',
    ],
  })
  expect(JSON.stringify(safeErrorDiagnostics(error))).not.toContain(
    'private API key',
  )
})

test('drops multiline message injection, SQL lines, URL credentials and non-frame text', () => {
  const error = new Error(
    'secret\n    at stolen (/request/secret-token.js:1:1)',
  )
  error.stack = `Error: ${error.message}\nSELECT private_secret FROM secrets\n    at function (https://user:password@example.com/secret.js:2:3)\n    at function (/workspace/server/api/handler.ts?token=secret:2:3)\n    at handle (/workspace/src/server/api/handler.ts:4:5)`
  expect(safeErrorDiagnostics(error).stackFrames).toEqual([
    'at handle (src/server/api/handler.ts:4:5)',
  ])
})

test('caps frame count and handles nonstandard errors without throwing', () => {
  const error = new Error('message')
  error.stack = `Error: message\n${Array.from({ length: 100 }, (_, index) => `    at function (/workspace/src/server/api/handler.ts:${index + 1}:1)`).join('\n')}`
  expect(safeErrorDiagnostics(error).stackFrames).toHaveLength(8)
  expect(safeErrorDiagnostics({ stack: 'at request-secret.js:1:1' })).toEqual({
    errorName: 'unknown',
    stackFrames: [],
  })
  Object.defineProperty(error, 'stack', {
    get: () => {
      throw new Error('getter-secret')
    },
  })
  expect(safeErrorDiagnostics(error)).toEqual({
    errorName: 'Error',
    stackFrames: [],
  })
})
