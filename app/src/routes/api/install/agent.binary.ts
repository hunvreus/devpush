import { createFileRoute } from '@tanstack/react-router'

import {
  AgentBinaryNotConfiguredError,
  AgentBinaryUnsupportedPlatformError,
  getAgentBinary,
} from '@/server/install/agent-binary'

export const Route = createFileRoute('/api/install/agent/binary')({
  server: {
    handlers: {
      HEAD: async ({ request }) => {
        try {
          const { size, filename } = await getAgentBinary(
            getRequestedPlatform(request),
          )

          return new Response(null, {
            headers: binaryHeaders(size, filename),
          })
        } catch (error) {
          return binaryErrorResponse(error)
        }
      },
      GET: async ({ request }) => {
        try {
          const { body, filename, size } = await getAgentBinary(
            getRequestedPlatform(request),
          )

          return new Response(new Uint8Array(body), {
            headers: binaryHeaders(size, filename),
          })
        } catch (error) {
          return binaryErrorResponse(error)
        }
      },
    },
  },
})

function getRequestedPlatform(request: Request) {
  const url = new URL(request.url)

  return {
    arch: url.searchParams.get('arch'),
    os: url.searchParams.get('os'),
  }
}

function binaryErrorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to read configured agent binary.',
    },
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

function binaryHeaders(size: number, filename: string) {
  return {
    'cache-control': 'no-store',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': String(size),
    'content-type': 'application/octet-stream',
  }
}
