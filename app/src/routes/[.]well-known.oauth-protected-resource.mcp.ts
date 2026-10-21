import { createFileRoute } from '@tanstack/react-router'
import { getMcpResourceMetadata } from '@/server/mcp/handler'

export const Route = createFileRoute(
  '/.well-known/oauth-protected-resource/mcp',
)({ server: { handlers: { GET: () => getMcpResourceMetadata() } } })
