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
    ['/\t/evil.test', '/'],
    ['/\n/evil.test', '/'],
    ['/\r/evil.test', '/'],
    ['/\\/@evil.test', '/'],
    ['/.//evil.test', '/'],
    ['/..//evil.test', '/'],
    ['/%2e//evil.test', '/'],
    ['/foo/..//evil.test', '/'],
  ])('rejects unsafe redirect target %j', (value, expected) => {
    expect(getSafeRedirectPath(value)).toBe(expected)
  })

  test.each([
    ['/', '/'],
    ['/projects', '/projects'],
    ['/projects?tab=active', '/projects?tab=active'],
    ['/projects#deployments', '/projects#deployments'],
    ['/projects/%E2%9C%93', '/projects/%E2%9C%93'],
    ['/%5cevil.test/path', '/%5cevil.test/path'],
    ['/%2f%2fevil.test/path', '/%2f%2fevil.test/path'],
    ['/search?q=a%5Cb', '/search?q=a%5Cb'],
    ['/%255Cevil.test', '/%255Cevil.test'],
  ])('preserves safe internal redirect target %j', (value, expected) => {
    expect(getSafeRedirectPath(value)).toBe(expected)
  })

  test.each([
    ['/projects'],
    ['/\\evil.test'],
    ['/\t/evil.test'],
    ['/.//evil.test'],
    ['/%2e//evil.test'],
    ['/%2f%2fevil.test'],
  ])('always produces a same-origin redirect for %j', (value) => {
    const appOrigin = 'https://devpush.example'
    const path = getSafeRedirectPath(value)

    expect(new URL(path, appOrigin).origin).toBe(appOrigin)
  })
})
