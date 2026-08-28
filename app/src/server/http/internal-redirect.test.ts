import { describe, expect, test } from 'vitest'

import { getSafeRedirectPath } from './internal-redirect'

describe('getSafeRedirectPath', () => {
  test.each([
    [null, '/'],
    ['', '/'],
    ['dashboard', '/'],
    ['https://evil.test/path', '/'],
    ['//evil.test/path', '/'],
    ['/\\evil.test/path', '/'],
    ['\\\\evil.test/path', '/'],
    ['/%5cevil.test/path', '/'],
    ['/%2f%2fevil.test/path', '/'],
    ['/%E0%A4%A', '/'],
  ])('rejects unsafe redirect target %j', (value, expected) => {
    expect(getSafeRedirectPath(value)).toBe(expected)
  })

  test.each([
    ['/', '/'],
    ['/projects', '/projects'],
    ['/projects?tab=active', '/projects?tab=active'],
    ['/projects#deployments', '/projects#deployments'],
    ['/projects/%E2%9C%93', '/projects/%E2%9C%93'],
  ])('preserves safe internal redirect target %j', (value, expected) => {
    expect(getSafeRedirectPath(value)).toBe(expected)
  })
})
