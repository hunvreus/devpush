import { describe, expect, test } from 'vitest'
import { isUniqueConstraintError } from './errors'

describe('SQLite unique failures', () => {
  test('recognizes native failures, wrapped causes, and D1 messages', () => {
    for (const error of [
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
      { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' },
      new Error('query failed', {
        cause: { code: 'SQLITE_CONSTRAINT_UNIQUE' },
      }),
      new Error(
        'D1_ERROR: UNIQUE constraint failed: deployments.runtime_id: SQLITE_CONSTRAINT',
      ),
    ])
      expect(isUniqueConstraintError(error)).toBe(true)
  })
  test('does not hide foreign-key failures or unrelated errors', () => {
    for (const error of [
      null,
      undefined,
      'error',
      { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' },
      new Error('database is locked'),
    ])
      expect(isUniqueConstraintError(error)).toBe(false)
  })
})
