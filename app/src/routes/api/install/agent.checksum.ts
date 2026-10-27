import { createFileRoute } from '@tanstack/react-router'

import {
  AgentBinaryNotConfiguredError,
  AgentBinaryUnsupportedPlatformError,
  getAgentBinaryChecksum,
} from '#devpush/server/install/agent-binary'

export const Route = createFileRoute('/api/install/agent/checksum')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const binary = await getAgentBinaryChecksum({
            arch: url.searchParams.get('arch'),
            os: url.searchParams.get('os'),
          })
          return new Response(`${binary.digest}  ${binary.filename}\n`, {
            headers: {
              'cache-control': 'no-store',
              'content-type': 'text/plain; charset=utf-8',
            },
          })
        } catch (error) {
          const expected =
            error instanceof AgentBinaryNotConfiguredError ||
            error instanceof AgentBinaryUnsupportedPlatformError
          if (!expected) console.error('Agent checksum unavailable.', error)
          return Response.json(
            { error: expected ? error.message : 'Agent checksum unavailable.' },
            {
              status:
                error instanceof AgentBinaryNotConfiguredError
                  ? 501
                  : error instanceof AgentBinaryUnsupportedPlatformError
                    ? 400
                    : 500,
            },
          )
        }
      },
    },
  },
})
