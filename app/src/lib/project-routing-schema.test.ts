import { expect, test } from 'vitest'
import {
  projectRoutesSchema,
  projectDomainsSchema,
} from './project-routing-schema'

const base = { teamSlug: 'team', projectName: 'project' }
const route = { path: '/', service: 'web', port: 80 }
const domain = {
  host: 'example.com',
  environmentId: 'e',
  basePath: '',
  https: true,
}
test.each([
  { service: '' },
  { service: 'bad service' },
  { port: 0 },
  { port: 65536 },
  { port: 1.5 },
  { path: 'missing-slash' },
  { path: '/bad path' },
])('rejects invalid route fields %j', (change) => {
  expect(
    projectRoutesSchema.safeParse({
      ...base,
      routes: [{ ...route, ...change }],
    }).success,
  ).toBe(false)
})
test('route duplicates are rejected within scope, while environment overrides remain valid', () => {
  const result = projectRoutesSchema.safeParse({
    ...base,
    routes: [route, { ...route, path: ' / ' }],
  })
  expect(result.success).toBe(false)
  if (!result.success)
    expect(result.error.issues[0]?.path).toEqual(['routes', 1, 'path'])
  expect(
    projectRoutesSchema.safeParse({
      ...base,
      routes: [route, { ...route, environmentId: 'e' }],
    }).success,
  ).toBe(true)
})
test.each([
  '',
  'https://example.com',
  'example.com/path',
  '*.example.com',
  'example.com:443',
  '-invalid.com',
  `${'a'.repeat(64)}.com`,
])('rejects invalid domain %s', (host) => {
  expect(
    projectDomainsSchema.safeParse({ ...base, domains: [{ ...domain, host }] })
      .success,
  ).toBe(false)
})
test('domain duplicates are case-insensitive and report the duplicated row', () => {
  const result = projectDomainsSchema.safeParse({
    ...base,
    domains: [domain, { ...domain, host: ' EXAMPLE.COM ' }],
  })
  expect(result.success).toBe(false)
  if (!result.success)
    expect(result.error.issues[0]?.path).toEqual(['domains', 1, 'host'])
})
test('empty collections permit removing all routes and domains', () => {
  expect(projectRoutesSchema.safeParse({ ...base, routes: [] }).success).toBe(
    true,
  )
  expect(projectDomainsSchema.safeParse({ ...base, domains: [] }).success).toBe(
    true,
  )
})
