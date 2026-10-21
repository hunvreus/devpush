import { expect, test } from 'vitest'
import { projectEnvironmentsSchema } from './project-environments-schema'

const row = {
  id: 'e',
  name: 'Production',
  slug: 'production',
  branch: 'main',
  color: 'lime',
  position: 0,
  status: 'active',
  effectiveServerId: null,
  serverId: null,
}
const base = { teamSlug: 'team', projectName: 'project' }
test.each([
  { name: '' },
  { branch: '' },
  { slug: 'bad slug' },
  { name: 'x'.repeat(256) },
  { branch: 'x'.repeat(256) },
])('rejects invalid environment fields %j', (patch) => {
  expect(
    projectEnvironmentsSchema.safeParse({
      settingsVersion: 1, projectId: 'p',
      ...base,
      environments: [{ ...row, ...patch }],
    }).success,
  ).toBe(false)
})
test('production is required and duplicate identifiers target the duplicated row', () => {
  expect(
    projectEnvironmentsSchema.safeParse({
      settingsVersion: 1, projectId: 'p',
      ...base,
      environments: [{ ...row, slug: 'staging' }],
    }).success,
  ).toBe(false)
  const result = projectEnvironmentsSchema.safeParse({
    settingsVersion: 1, projectId: 'p',
    ...base,
    environments: [row, { ...row, id: 'e2', slug: ' production ' }],
  })
  expect(result.success).toBe(false)
  if (!result.success)
    expect(result.error.issues[0]?.path).toEqual(['environments', 1, 'slug'])
})
test('wildcard branch rules remain supported', () => {
  expect(
    projectEnvironmentsSchema.safeParse({
      settingsVersion: 1, projectId: 'p',
      ...base,
      environments: [{ ...row, branch: 'release/*' }],
    }).success,
  ).toBe(true)
})
test('definition saves do not include stale server assignments', () => {
  const parsed = projectEnvironmentsSchema.parse({
    settingsVersion: 1, projectId: 'p',
    ...base,
    environments: [{ ...row, serverId: 'stale-server' }],
  })
  expect(parsed.environments[0]).not.toHaveProperty('serverId')
  expect(parsed.environments[0]).not.toHaveProperty('effectiveServerId')
})
