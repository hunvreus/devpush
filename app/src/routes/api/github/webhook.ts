import { createFileRoute } from '@tanstack/react-router'

import { handleGitHubInstallationWebhook } from '@/server/github/service'
import {
  getBranchFromGitHubRef,
  parseGitHubInstallationWebhookPayload,
  parseGitHubPushPayload,
  verifyGitHubWebhookSignature,
} from '@/server/github/webhooks'
import { createDeploymentsForGitHubPush } from '@/server/projects/service'
import {
  RequestBodyTooLargeError,
  readRequestText,
} from '@/server/http/request-body'

const maxGitHubWebhookBytes = 26 * 1024 * 1024

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: string

        try {
          body = await readRequestText(request, maxGitHubWebhookBytes)
        } catch (error) {
          if (error instanceof RequestBodyTooLargeError) {
            return Response.json(
              { error: 'Webhook payload is too large.' },
              { status: 413 },
            )
          }

          throw error
        }

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
        const deliveryId = request.headers.get('x-github-delivery')?.trim()

        if (!deliveryId || deliveryId.length > 255) {
          return Response.json(
            { error: 'Missing or invalid GitHub delivery ID.' },
            { status: 400 },
          )
        }

        if (
          event === 'installation' ||
          event === 'installation_repositories' ||
          event === 'installation_target'
        ) {
          try {
            const installationPayload =
              parseGitHubInstallationWebhookPayload(body)
            await handleGitHubInstallationWebhook({
              action: installationPayload.action,
              event,
              installationId: installationPayload.installationId,
            })
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'Invalid GitHub installation webhook payload.'
            ) {
              return Response.json({ error: error.message }, { status: 400 })
            }

            throw error
          }

          return Response.json({ ok: true })
        }

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
          deliveryId,
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
