import { createFileRoute } from '@tanstack/react-router'

import { AGENT_INSTALL_SCRIPT } from '#devpush/server/install/agent-script'

export const Route = createFileRoute('/api/install/agent')({
  server: {
    handlers: {
      HEAD: async () =>
        new Response(null, {
          headers: installScriptHeaders(),
        }),
      GET: async () =>
        new Response(AGENT_INSTALL_SCRIPT, {
          headers: installScriptHeaders(),
        }),
    },
  },
})

function installScriptHeaders() {
  return {
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(AGENT_INSTALL_SCRIPT)),
    'content-type': 'text/x-shellscript; charset=utf-8',
  }
}
