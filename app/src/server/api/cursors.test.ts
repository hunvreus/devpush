import { describe, expect, test, vi } from 'vitest'
import { apiFingerprint, decodeApiCursor, encodeApiCursor } from './cursors'

vi.mock('@/server/config', () => ({
  config: { DEVPUSH_SECRET_ENCRYPTION_KEY: 'test-cursor-secret' },
}))

describe('public API cursor and request fingerprints', () => {
  test('fingerprints do not depend on the runtime collation locale', () => {
    const compare = vi.spyOn(String.prototype, 'localeCompare')
    try {
      const english = new Intl.Collator('en')
      compare.mockImplementation(function (this: string, other: string) {
        return english.compare(this, other)
      })
      const first = apiFingerprint({ z: 1, ä: 2 })
      const swedish = new Intl.Collator('sv')
      compare.mockImplementation(function (this: string, other: string) {
        return swedish.compare(this, other)
      })
      expect(apiFingerprint({ z: 1, ä: 2 })).toBe(first)
    } finally {
      compare.mockRestore()
    }
  })
  test('cursors are bound to the resource and filter context', () => {
    const cursor = encodeApiCursor('projects:team-a', 123, 'project-a')
    expect(decodeApiCursor(cursor, 'projects:team-a')).toMatchObject({
      position: 123,
      id: 'project-a',
    })
    expect(() => decodeApiCursor(cursor, 'projects:team-b')).toThrow(
      'different query',
    )
    expect(() =>
      decodeApiCursor(cursor.replace('123', '124') + 'x', 'projects:team-a'),
    ).toThrow()
    expect(() => decodeApiCursor('not-a-cursor', 'projects:team-a')).toThrow()
  })
  test('request hashes are canonical and keyed, including secret inputs', () => {
    expect(apiFingerprint({ a: 1, b: 'secret' })).toBe(
      apiFingerprint({ b: 'secret', a: 1 }),
    )
    expect(apiFingerprint({ a: 1 })).not.toBe(apiFingerprint({ a: 2 }))
    expect(apiFingerprint('secret')).not.toContain('secret')
  })
})
