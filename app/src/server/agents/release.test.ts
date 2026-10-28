import { expect, test } from 'vitest'
import manifest from '../../../agent-release.json'
import { validateAgentRelease } from '#devpush/lib/agent-release.mjs'
import {
  currentAgentCapabilities,
  currentAgentProtocolVersion,
} from './compatibility'

test('the pinned shared binary supports the control-plane protocol and capabilities', () => {
  const release = validateAgentRelease(manifest)
  expect(release.protocolVersion).toBe(currentAgentProtocolVersion)
  expect(release.capabilities).toEqual(
    expect.arrayContaining(currentAgentCapabilities),
  )
})
