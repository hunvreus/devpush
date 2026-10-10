import { expect, test } from 'vitest'
import { createProjectSchema } from './project-creation-schema'

const input = {
  teamSlug: 'team',
  installationId: 1,
  projectName: 'project',
  repoFullName: 'owner/repo',
}
test.each([
  { projectName: '' },
  { projectName: 'invalid name' },
  { composePath: '../outside.yml' },
  { readinessPath: 'health' },
  { releaseCommand: 'x'.repeat(16385) },
  { envVars: [{ key: 'INVALID KEY', value: 'x' }] },
])('rejects invalid project fields', (change) => {
  expect(createProjectSchema.safeParse({ ...input, ...change }).success).toBe(
    false,
  )
})
test('rejects duplicate environment keys at the second row', () => {
  const parsed = createProjectSchema.safeParse({
    ...input,
    envVars: [
      { key: 'TOKEN', value: 'a' },
      { key: 'TOKEN', value: 'b' },
    ],
  })
  expect(parsed.success).toBe(false)
  if (!parsed.success)
    expect(parsed.error.issues[0]?.path).toEqual(['envVars', 1, 'key'])
})
test('allows no server and blank optional commands or compose path', () => {
  expect(
    createProjectSchema.safeParse({
      ...input,
      serverId: '',
      composePath: '',
      releaseCommand: '',
      releaseService: '',
      readinessPath: '',
    }).success,
  ).toBe(true)
})
