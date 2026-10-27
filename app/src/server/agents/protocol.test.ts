import { describe, expect, test } from 'vitest'

import { z } from 'zod'

import {
  AgentRequestError,
  agentJobProgressSchema,
  completeAgentJobSchema,
  agentMetadataSchema,
  deploymentEventSchema,
  handleAgentRequest,
  heartbeatSchema,
} from './protocol'

describe('agent protocol', () => {
  test('validates bounded timestamped metric history batches', () => {
    const sample = {
      id: 'a'.repeat(32),
      observedAt: '2026-10-09T00:00:00.000Z',
      metrics: { cpuPercent: 12 },
    }
    const request = {
      serverId: 'server',
      token: 'token',
      metricSamples: [sample],
    }
    expect(heartbeatSchema.safeParse(request).success).toBe(true)
    for (const invalid of [
      { ...sample, id: 'invalid' },
      { ...sample, observedAt: 'invalid' },
      { ...sample, metrics: {} },
      { ...sample, metrics: { cpuPercent: 101 } },
    ])
      expect(
        heartbeatSchema.safeParse({ ...request, metricSamples: [invalid] })
          .success,
      ).toBe(false)
    expect(
      heartbeatSchema.safeParse({
        ...request,
        metricSamples: Array(241).fill(sample),
      }).success,
    ).toBe(false)
  })
  test('requires a stable positive sequence in deployment completion requests', () => {
    const completion = {
      type: 'deploy',
      serverId: 'server',
      token: 'token',
      deploymentId: 'deployment',
      status: 'succeeded',
      gitSha: null,
      logs: ['tail'],
      events: [],
    }
    expect(completeAgentJobSchema.safeParse(completion).success).toBe(false)
    expect(
      completeAgentJobSchema.safeParse({ ...completion, logStartSeq: 0 })
        .success,
    ).toBe(false)
    expect(
      completeAgentJobSchema.safeParse({ ...completion, logStartSeq: 1 })
        .success,
    ).toBe(true)
  })

  test('treats agent versions as optional metadata', () => {
    expect(agentMetadataSchema.parse({})).toEqual({})
    expect(
      agentMetadataSchema.parse({
        agentVersion: '0.1.0',
        protocolVersion: 1,
        capabilities: ['jobs.compose.deploy.v1'],
      }),
    ).toEqual({
      agentVersion: '0.1.0',
      protocolVersion: 1,
      capabilities: ['jobs.compose.deploy.v1'],
    })
  })

  test('validates deployment phases from the shared contract', () => {
    expect(
      deploymentEventSchema.parse({
        phase: 'traffic_switched',
        message: 'Traffic switched.',
      }),
    ).toEqual({ phase: 'traffic_switched', message: 'Traffic switched.' })
    expect(
      deploymentEventSchema.safeParse({ phase: 'unknown', message: 'No.' })
        .success,
    ).toBe(false)
  })

  test('accepts per-alias readiness verification events', () => {
    expect(
      deploymentEventSchema.parse({
        phase: 'readiness_check_succeeded',
        message: 'Verified deployment.example.com/health.',
      }).phase,
    ).toBe('readiness_check_succeeded')
    const progress = {
      serverId: 'server-1',
      token: 'token',
      deploymentId: 'deployment-1',
      logStartSeq: 1,
      logs: ['Verified deployment.example.com/health.'],
      events: [
        {
          phase: 'readiness_check_succeeded',
          message: 'Verified deployment.example.com/health.',
        },
      ],
    }
    expect(agentJobProgressSchema.safeParse(progress).success).toBe(true)
    expect(
      completeAgentJobSchema.safeParse({
        ...progress,
        type: 'deploy',
        status: 'succeeded',
        gitSha: 'abc123',
      }).success,
    ).toBe(true)
  })

  test('bounds deployment log and event batches', async () => {
    const oversizedLogs = Array.from({ length: 5_001 }, () => 'line')
    const response = await handleAgentRequest(
      new Request('https://devpush.test/api/agents/jobs/progress', {
        method: 'POST',
        body: JSON.stringify({
          serverId: 'server-1',
          token: 'token',
          deploymentId: 'deployment-1',
          logStartSeq: 1,
          logs: oversizedLogs,
          events: [],
        }),
      }),
      agentJobProgressSchema,
      () => ({ ok: true }),
      'Unable to record progress.',
    )

    expect(response.status).toBe(400)

    expect(
      agentJobProgressSchema.safeParse({
        serverId: 'server-1',
        token: 'token',
        deploymentId: 'deployment-1',
        logStartSeq: 1,
        logs: ['x'.repeat(66 * 1024 + 1)],
        events: [],
      }).success,
    ).toBe(false)
    expect(
      agentJobProgressSchema.safeParse({
        serverId: 'server-1',
        token: 'token',
        deploymentId: 'deployment-1',
        logStartSeq: 1,
        logs: [],
        events: Array.from({ length: 101 }, () => ({
          phase: 'completed' as const,
          message: 'Done.',
        })),
      }).success,
    ).toBe(false)
  })

  test('returns 400 for malformed agent payloads', async () => {
    const response = await handleAgentRequest(
      new Request('https://devpush.test/api/agents/test', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      z.strictObject({ token: z.string().min(1) }),
      () => ({ ok: true }),
      'Unable to process agent request.',
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request payload.',
    })
  })

  test('preserves explicit agent error statuses', async () => {
    const response = await handleAgentRequest(
      new Request('https://devpush.test/api/agents/test', {
        method: 'POST',
        body: JSON.stringify({ token: 'secret' }),
      }),
      z.strictObject({ token: z.string() }),
      () => {
        throw new AgentRequestError(409, 'Job is no longer running.')
      },
      'Unable to process agent request.',
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Job is no longer running.',
    })
  })

  test('rejects oversized payloads before parsing them', async () => {
    const response = await handleAgentRequest(
      new Request('https://devpush.test/api/agents/test', {
        method: 'POST',
        headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
        body: '{}',
      }),
      z.unknown(),
      () => ({ ok: true }),
      'Unable to process agent request.',
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: 'Request payload is too large.',
    })
  })
  test('preserves provider polling responses and enforces endpoint-specific body limits', async () => {
    const request = (token: string) =>
      new Request('https://devpush.test/api/agents/certificates', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
    const polling = Response.json(
      { status: 'pending' },
      { status: 202, headers: { 'Retry-After': '12' } },
    )
    const response = await handleAgentRequest(
      request('secret'),
      z.object({ token: z.string() }),
      () => polling,
      'Failed.',
      64,
    )
    expect(response).toBe(polling)
    expect(response.headers.get('Retry-After')).toBe('12')
    let called = false
    const oversized = await handleAgentRequest(
      request('x'.repeat(65)),
      z.unknown(),
      () => {
        called = true
      },
      'Failed.',
      64,
    )
    expect(oversized.status).toBe(413)
    expect(called).toBe(false)
  })
})

test('enrollment policy denials return a public 403 with recovery details', async () => {
  const { PublicError } = await import('#devpush/lib/public-error')
  const response = await handleAgentRequest(
    new Request('http://localhost/api/agents/register', {
      method: 'POST',
      body: '{}',
    }),
    z.object({}),
    async () => {
      throw new PublicError('WORKSPACE_RESTRICTED', undefined, {
        message: 'This workspace is archived. Restore it to connect this server.',
        recoveryUrl: '/acme/settings#general',
      })
    },
    'Unable to register agent.',
  )
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({
    code: 'WORKSPACE_RESTRICTED',
    error: 'This workspace is archived. Restore it to connect this server.',
    policy: { recoveryUrl: '/acme/settings#general' },
  })
})
