import { createFileRoute } from '@tanstack/react-router'

import { config } from '@/server/config'
import { AGENT_INSTALL_SCRIPT } from '@/server/install/agent-script'

export const Route = createFileRoute('/api/install/agent/$token')({
  server: {
    handlers: {
      HEAD: async ({ params, request }) => {
        const script = buildTokenizedInstallScript({
          token: params.token,
          serverUrl: getRequestOrigin(request),
        })

        return new Response(null, {
          headers: installScriptHeaders(script),
        })
      },
      GET: async ({ params, request }) => {
        const script = buildTokenizedInstallScript({
          token: params.token,
          serverUrl: getRequestOrigin(request),
        })

        return new Response(script, {
          headers: installScriptHeaders(script),
        })
      },
    },
  },
})

function buildTokenizedInstallScript({
  token,
  serverUrl,
}: {
  token: string
  serverUrl: string
}) {
  const lines = [
    '#!/usr/bin/env bash',
    `export DEVPUSH_SERVER_URL=${shellQuote(serverUrl)}`,
    `export DEVPUSH_AGENT_TOKEN=${shellQuote(token)}`,
  ]

  if (config.DEVPUSH_TRAEFIK_EMAIL) {
    lines.push(
      `export DEVPUSH_TRAEFIK_EMAIL=${shellQuote(config.DEVPUSH_TRAEFIK_EMAIL)}`,
    )
  }

  return `${lines.join('\n')}\n${AGENT_INSTALL_SCRIPT.replace(
    /^#!\/usr\/bin\/env bash\n/,
    '',
  )}`
}

function installScriptHeaders(script: string) {
  return {
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(script)),
    'content-type': 'text/x-shellscript; charset=utf-8',
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const host = forwardedHost ?? request.headers.get('host') ?? url.host
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol

  return `${protocol}//${host}`
}
