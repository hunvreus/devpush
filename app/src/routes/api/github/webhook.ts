import { createFileRoute } from '@tanstack/react-router'

import {
  getBranchFromGitHubRef,
  parseGitHubPushPayload,
  verifyGitHubWebhookSignature,
} from '@/server/github/webhooks'
import { createDeploymentsForGitHubPush } from '@/server/projects/service'

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text()

        try {
          const isValidSignature = verifyGitHubWebhookSignature({
            body,
            signature: request.headers.get('x-hub-signature-256'),
          })

          if (!isValidSignature) {
            return Response.json(
              { error: 'Invalid signature.' },
              { status: 401 },
            )
          }
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'GitHub webhook verification failed.',
            },
            { status: 503 },
          )
        }

        let payload: ReturnType<typeof parseGitHubPushPayload> | null = null
        const event = request.headers.get('x-github-event')

        if (event === 'push') {
          try {
            payload = parseGitHubPushPayload(body)
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : 'Invalid GitHub webhook payload.',
              },
              { status: 400 },
            )
          }
        }

        if (event !== 'push') {
          return Response.json({ ok: true, ignored: event ?? 'unknown' })
        }

        if (!payload) {
          return Response.json(
            { error: 'Invalid GitHub webhook payload.' },
            { status: 400 },
          )
        }

        const branch = getBranchFromGitHubRef(payload.ref)
        const installationId = payload.installation?.id
        const repositoryId = payload.repository?.id
        const repositoryFullName = payload.repository?.full_name
        const gitSha = payload.head_commit?.id

        if (
          !branch ||
          typeof installationId !== 'number' ||
          !Number.isSafeInteger(installationId) ||
          typeof repositoryId !== 'number' ||
          !Number.isSafeInteger(repositoryId) ||
          !repositoryFullName ||
          !gitSha
        ) {
          return Response.json({ ok: true, ignored: 'unsupported_push' })
        }

        const result = await createDeploymentsForGitHubPush({
          installationId,
          repositoryId,
          repositoryFullName,
          branch,
          gitSha,
          message: payload.head_commit?.message ?? null,
        })

        return Response.json({ ok: true, ...result })
      },
    },
  },
})
