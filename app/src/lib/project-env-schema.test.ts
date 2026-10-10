import { expect, test } from 'vitest'
import { projectEnvVarsSchema } from './project-env-schema'

const base = { teamSlug: 'team', projectName: 'project' }
test('shared and scoped keys can override, but duplicates within a scope cannot', () => {
  const envVars = [
    { key: 'TOKEN', value: '' },
    { key: 'TOKEN', value: 'scoped', environment: 'e' },
  ]
  expect(projectEnvVarsSchema.safeParse({ ...base, envVars }).success).toBe(
    true,
  )
  const duplicate = projectEnvVarsSchema.safeParse({
    ...base,
    envVars: [envVars[0], { key: ' TOKEN ', value: '', environment: '' }],
  })
  expect(duplicate.success).toBe(false)
  if (!duplicate.success)
    expect(duplicate.error.issues[0]?.path).toEqual(['envVars', 1, 'key'])
})
test('empty values and removing all variables remain supported', () => {
  expect(
    projectEnvVarsSchema.safeParse({
      ...base,
      envVars: [{ key: 'EMPTY', value: '' }],
    }).success,
  ).toBe(true)
  expect(projectEnvVarsSchema.safeParse({ ...base, envVars: [] }).success).toBe(
    true,
  )
})
