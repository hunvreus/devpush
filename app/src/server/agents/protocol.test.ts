import { describe, expect, test } from 'vitest'

import { z } from 'zod'

import {
  AgentRequestError,
  agentJobProgressSchema,
  agentMetadataSchema,
  deploymentEventSchema,
  handleAgentRequest,
} from './protocol'

describe('agent protocol', () => {
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
})
