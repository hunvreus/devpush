import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createPublicOpenApiDocument,
  publicApiOperations,
} from './operation-contract'
import {
  publicDeploymentSchema,
  publicProjectSchema,
  publicServerSchema,
} from '#devpush/lib/public-api-schema'

describe('public management API contracts', () => {
  test('the published operation reference matches the live operation catalog', () => {
    const reference = readFileSync(
      new URL('../../../../docs/reference/api-operations.md', import.meta.url),
      'utf8',
    )
    const entries = [
      ...reference.matchAll(
        /^\| `((?:GET|POST|PUT|PATCH|DELETE) [^`]+)` \| `([^`]+)` \| (Yes|No) \| (.*?) \|$/gm,
      ),
    ]
    expect(entries).toHaveLength(publicApiOperations.length)
    const documented = new Map(
      entries.map((entry) => [
        entry[1],
        {
          scope: entry[2],
          mcp: entry[3] === 'Yes',
          description: entry[4],
        },
      ]),
    )
    expect(documented.size).toBe(publicApiOperations.length)
    for (const operation of publicApiOperations)
      expect(
        documented.get(`${operation.method} /api/v1${operation.path}`),
      ).toEqual({
        scope: operation.scope,
        mcp: operation.mcp,
        description: operation.description,
      })
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
