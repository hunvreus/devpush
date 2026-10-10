import { createFileRoute } from '@tanstack/react-router'

import { handleGitHubInstallationWebhook } from '@/server/github/service'
import {
  getBranchFromGitHubRef,
  parseGitHubInstallationWebhookPayload,
  parseGitHubPushPayload,
  requireGitHubWebhookConfiguration,
  validateGitHubWebhookHeaders,
  verifyGitHubWebhookSignature,
} from '@/server/github/webhooks'
import { createDeploymentsForGitHubPush } from '@/server/projects/deployments'
import {
  RequestBodyTooLargeError,
  readRequestText,
} from '@/server/http/request-body'
import { enforceRateLimit } from '@/server/http/rate-limit'

// GitHub permits larger payloads, but this endpoint buffers the body before
// signature verification and only consumes compact push/installation fields.
const maxGitHubWebhookBytes = 5 * 1024 * 1024

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const webhookHeaders = validateGitHubWebhookHeaders(request.headers)

        if (!webhookHeaders.ok) {
          return Response.json(
            { error: webhookHeaders.error },
            { status: webhookHeaders.status },
          )
        }

        try {
          requireGitHubWebhookConfiguration()
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

        const rateLimitResponse = await enforceRateLimit({
          limit: 120,
          request,
          scope: 'github-webhook',
          windowMs: 60_000,
        })
        if (rateLimitResponse) {
          return rateLimitResponse
        }

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
            signature: webhookHeaders.signature,
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
        const { deliveryId, event } = webhookHeaders

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
          return Response.json({ ok: true, ignored: event })
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
