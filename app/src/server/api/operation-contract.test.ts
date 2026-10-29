import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createPublicOpenApiDocument,
  publicApiOperations,
} from './operation-contract'
import {
  publicErrorResponseSchema,
  publicDeploymentSchema,
  publicProjectSchema,
  publicServerSchema,
} from '#devpush/lib/public-api-schema'

describe('public management API contracts', () => {
  test('the guide request and response examples validate against the public contracts', () => {
    const guide = readFileSync(
      new URL('../../../../docs/api.md', import.meta.url),
      'utf8',
    )
    const examples = [...guide.matchAll(/^```json\n([\s\S]*?)^```/gm)].map(
      (match) => JSON.parse(match[1]!),
    )
    expect(examples).toHaveLength(2)
    const deploy = publicApiOperations.find(
      (operation) => operation.id === 'deploy',
    )!
    expect(deploy.output.safeParse(examples[0]).success).toBe(true)
    expect(publicErrorResponseSchema.safeParse(examples[1]).success).toBe(true)
    const body = JSON.parse(guide.match(/--data '([^']+)'/)![1]!)
    expect(
      deploy.input.safeParse({
        ...body,
        projectId: 'PROJECT_ID',
        idempotencyKey: 'example-request-1',
      }).success,
    ).toBe(true)
    const mcp = readFileSync(
      new URL('../../../../docs/mcp.md', import.meta.url),
      'utf8',
    )
    const backup = publicApiOperations.find(
      (operation) => operation.id === 'run_backup',
    )!
    const args = JSON.parse(mcp.match(/^```json\n([\s\S]*?)^```/m)![1]!)
    expect(backup.input.safeParse(args).success).toBe(true)
  })

  test('the generated OpenAPI documents each implemented operation exactly once', () => {
    const document = createPublicOpenApiDocument()
    const operations = Object.values(document.paths).flatMap((path) =>
      Object.values(path),
    ) as {
      operationId: string
      parameters: { name: string; in: string; required: boolean }[]
      responses: Record<string, unknown>
    }[]
    expect(new Set(operations.map((entry) => entry.operationId)).size).toBe(
      publicApiOperations.length,
    )
    for (const entry of publicApiOperations) {
      const documented = operations.find(
        (candidate) => candidate.operationId === entry.id,
      )!
      expect(documented.responses[String(entry.status)]).toBeDefined()
      if (!entry.readOnly)
        expect(documented.parameters).toContainEqual(
          expect.objectContaining({
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
          }),
        )
      expect(
        entry.input.safeParse({ projectId: 'id', privateTransportField: true })
          .success,
      ).toBe(false)
    }
  })

  test('public resource schemas reject private aggregate fields', () => {
    const createdAt = new Date().toISOString()
    const project = {
      id: 'p',
      teamId: 't',
      name: 'p',
      slug: 'p',
      repository: 'owner/repo',
      repositoryId: 1,
      defaultServerId: null,
      settingsVersion: 1,
      createdAt,
    }
    expect(publicProjectSchema.safeParse(project).success).toBe(true)
    expect(
      publicProjectSchema.safeParse({
        ...project,
        envVarsEncrypted: 'ciphertext',
      }).success,
    ).toBe(false)
    expect(
      publicDeploymentSchema.safeParse({
        id: 'd',
        projectId: 'p',
        environmentId: 'e',
        serverId: 's',
        status: 'succeeded',
        phase: null,
        trigger: 'api',
        repository: 'owner/repo',
        sha: 'abc',
        branch: 'main',
        createdAt,
        startedAt: null,
        finishedAt: null,
        config: {},
        envVars: 'ciphertext',
      }).success,
    ).toBe(false)
    expect(
      publicServerSchema.safeParse({
        settingsVersion: 1,
        id: 's',
        teamId: 't',
        name: 's',
        status: 'pending',
        publicAddress: null,
        agentVersion: null,
        lastSeenAt: null,
        createdAt,
        agentCredentialHash: 'secret',
      }).success,
    ).toBe(false)
  })
})
