import { describe, expect, test } from 'vitest'

import { z } from 'zod'

import {
  AgentRequestError,
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
})
