import { createFileRoute } from '@tanstack/react-router'

import { config } from '@/server/config'
import { buildTokenizedAgentInstallScript } from '@/server/install/agent-script'

export const Route = createFileRoute('/api/install/agent/$token')({
  server: {
    handlers: {
      HEAD: async ({ params }) => {
        const script = buildTokenizedAgentInstallScript({
          autoUpdate: config.DEVPUSH_AGENT_AUTO_UPDATE,
          baseUrl: config.DEVPUSH_BASE_URL,
          token: params.token,
          traefikEmail: config.DEVPUSH_TRAEFIK_EMAIL,
        })

        return new Response(null, {
          headers: installScriptHeaders(script),
        })
      },
      GET: async ({ params }) => {
        const script = buildTokenizedAgentInstallScript({
          autoUpdate: config.DEVPUSH_AGENT_AUTO_UPDATE,
          baseUrl: config.DEVPUSH_BASE_URL,
          token: params.token,
          traefikEmail: config.DEVPUSH_TRAEFIK_EMAIL,
        })

        return new Response(script, {
          headers: installScriptHeaders(script),
        })
      },
    },
  },
})

function installScriptHeaders(script: string) {
  return {
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(script)),
    'content-type': 'text/x-shellscript; charset=utf-8',
  }
}
