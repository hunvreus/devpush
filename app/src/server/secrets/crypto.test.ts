import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { config } from '@/server/config'
import { decryptSecret, encryptSecret } from './crypto'

let previousKey: string | undefined

beforeEach(() => {
  previousKey = config.DEVPUSH_SECRET_ENCRYPTION_KEY
  config.DEVPUSH_SECRET_ENCRYPTION_KEY =
    'test-encryption-key-at-least-32-characters'
})

afterEach(() => {
  config.DEVPUSH_SECRET_ENCRYPTION_KEY = previousKey
})

describe('secret encryption', () => {
  test('round trips unicode values with a versioned payload', () => {
    const encrypted = encryptSecret('pässword 🔐')

    expect(encrypted).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/)
    expect(decryptSecret(encrypted)).toBe('pässword 🔐')
  })

  test('uses a fresh nonce for each encryption', () => {
    expect(encryptSecret('same value')).not.toBe(encryptSecret('same value'))
  })

  test('rejects malformed and tampered payloads', () => {
    const encrypted = encryptSecret('secret')
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`

    expect(() => decryptSecret('v2:invalid')).toThrow(
      'Invalid encrypted secret payload.',
    )
    expect(() => decryptSecret(tampered)).toThrow()
  })
})
