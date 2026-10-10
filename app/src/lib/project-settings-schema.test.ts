import { expect, test } from 'vitest'
import {
  projectSettingsSchema,
  projectSettingsErrors,
  projectValidationErrors,
} from './project-settings-schema'
import { formErrors } from './form-errors'
import { createComposeRuntimeConfig } from '@/server/projects/runtime-config'

const input = {
  teamSlug: 'team',
  currentProjectName: 'project',
  projectName: 'project',
  repoFullName: 'owner/repo',
  installationId: 1,
  runtimeConfig: createComposeRuntimeConfig(),
}
test.each([0, 59, 7201, 60.5, NaN])(
  'rejects invalid timeout %s at its field',
  (timeoutSeconds) => {
    const result = projectSettingsSchema.safeParse({
      ...input,
      runtimeConfig: createComposeRuntimeConfig({ timeoutSeconds }),
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(
        formErrors(result.error.issues)['runtimeConfig.timeoutSeconds'],
      ).toBeTruthy()
  },
)
test.each([60, 61, 7200])(
  'accepts whole-second timeout %s',
  (timeoutSeconds) => {
    expect(
      projectSettingsSchema.safeParse({
        ...input,
        runtimeConfig: createComposeRuntimeConfig({ timeoutSeconds }),
      }).success,
    ).toBe(true)
  },
)
test('reports command size, path, and name errors independently', () => {
  const result = projectSettingsSchema.safeParse({
    ...input,
    projectName: '',
    runtimeConfig: createComposeRuntimeConfig({
      path: '../compose.yml',
      deployCommand: 'x'.repeat(16385),
    }),
  })
  expect(result.success).toBe(false)
  if (!result.success)
    expect(Object.keys(formErrors(result.error.issues))).toEqual([
      'projectName',
      'runtimeConfig.path',
      'runtimeConfig.deployCommand',
    ])
})
test('only maps known business failures to fields', () => {
  expect(
    projectSettingsErrors(
      new Error('Project names must be unique within a team.'),
    ),
  ).toEqual({ projectName: 'Project names must be unique within a team.' })
  expect(projectSettingsErrors(new Error('SQLITE_BUSY'))).toBeNull()
})

test('hidden identity fields map to a visible repository or form error', () => {
  expect(
    projectValidationErrors([
      { path: ['installationId'], message: 'Invalid number' },
      { path: ['teamSlug'], message: 'Required' },
    ]),
  ).toEqual({
    repoFullName: 'Select a valid GitHub App installation for this repository.',
    form: 'This project could not be identified. Reload the page and try again.',
  })
})
