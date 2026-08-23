import { describe, expect, test } from 'vitest'

import {
  canAgentRunDeployments,
  currentAgentCapabilities,
  getAgentUpdate,
} from './compatibility'

const currentMetadata = {
  agentVersion: '1.2.0',
  protocolVersion: 1,
  capabilities: [...currentAgentCapabilities],
}

describe('agent compatibility', () => {
  test('requires an update when job capabilities are unavailable', () => {
    expect(
      getAgentUpdate({
        agentVersion: '0.1.0',
        protocolVersion: null,
        capabilities: null,
        latestVersion: '1.2.0',
        recommendedVersion: null,
      }),
    ).toMatchObject({ status: 'required' })
  })

  test('reports an optional newer agent release', () => {
    expect(
      getAgentUpdate({
        ...currentMetadata,
        agentVersion: '1.1.0',
        latestVersion: '1.2.0',
        recommendedVersion: null,
      }),
    ).toMatchObject({ status: 'available' })
  })

  test('reports a recommended minimum independently of protocol support', () => {
    expect(
      getAgentUpdate({
        ...currentMetadata,
        agentVersion: '1.0.0',
        latestVersion: '1.2.0',
        recommendedVersion: '1.1.0',
      }),
    ).toMatchObject({ status: 'recommended' })
  })

  test('does not compare development build labels as releases', () => {
    expect(
      getAgentUpdate({
        ...currentMetadata,
        agentVersion: 'dev',
        latestVersion: '1.2.0',
        recommendedVersion: null,
      }),
    ).toMatchObject({ status: 'current' })
  })

  test('only allows deployment jobs with the current protocol and capability', () => {
    expect(
      canAgentRunDeployments({
        protocolVersion: 1,
        capabilities: [...currentAgentCapabilities],
      }),
    ).toBe(true)
    expect(
      canAgentRunDeployments({
        protocolVersion: 2,
        capabilities: [...currentAgentCapabilities],
      }),
    ).toBe(false)
    expect(
      canAgentRunDeployments({ protocolVersion: 1, capabilities: [] }),
    ).toBe(false)
  })
})
