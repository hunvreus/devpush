import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'

export function oauthDiscoveryPlugins() {
  return [
    cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
  ] as const
}
