import { expect, test } from 'vitest'

import { matchesBearerSecret } from './auth'

test('accepts only an exact configured bearer secret', () => {
  expect(matchesBearerSecret('Bearer secret', 'secret')).toBe(true)
  for (const header of [null, '', 'secret', 'Bearer wrong!', 'Bearer secrét']) {
    expect(matchesBearerSecret(header, 'secret')).toBe(false)
  }
  expect(matchesBearerSecret('Bearer ', '')).toBe(false)
})
