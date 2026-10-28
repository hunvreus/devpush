import { notifyProject } from '#devpush/server/realtime/service'
import { notifyAfterProjectUpdate } from '#devpush/server/notifications/observe'
import { handleGitHubInstallationWebhook } from '#devpush/server/github/service'
import {
  getBranchFromGitHubRef,
  InvalidGitHubInstallationPayloadError,
  parseGitHubInstallationWebhookPayload,
  parseGitHubPushPayload,
  requireGitHubWebhookConfiguration,
  validateGitHubWebhookHeaders,
  verifyGitHubWebhookSignature,
} from '#devpush/server/github/webhooks'
import { createDeploymentsForGitHubPush } from '#devpush/server/projects/deployments'
import {
  RequestBodyTooLargeError,
  readRequestText,
} from '#devpush/server/http/request-body'
import { enforceRateLimit } from '#devpush/server/http/rate-limit'

// GitHub permits larger payloads, but this endpoint buffers the body before
// signature verification and only consumes compact push/installation fields.
const maxGitHubWebhookBytes = 5 * 1024 * 1024

export async function handleGitHubWebhook(request: Request) {
  const webhookHeaders = validateGitHubWebhookHeaders(request.headers)

  if (!webhookHeaders.ok) {
    if (webhookHeaders.status === 401) {
      const limited = await enforceRateLimit({
        limit: 120,
        request,
        scope: 'github-webhook',
        windowMs: 60_000,
      })
      if (limited) return limited
    }
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
      const rateLimitResponse = await enforceRateLimit({
        limit: 120,
        request,
        scope: 'github-webhook',
        windowMs: 60_000,
      })
      if (rateLimitResponse) {
        return rateLimitResponse
      }

      return Response.json({ error: 'Invalid signature.' }, { status: 401 })
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
      const installationPayload = parseGitHubInstallationWebhookPayload(body)
      await handleGitHubInstallationWebhook({
        action: installationPayload.action,
        event,
        installationId: installationPayload.installationId,
      })
    } catch (error) {
      if (error instanceof InvalidGitHubInstallationPayloadError) {
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
    authorName: payload.head_commit?.author?.name ?? null,
    authoredAt: payload.head_commit?.timestamp ?? null,
    commitUrl: payload.head_commit?.url ?? null,
    githubSenderId:
      Number.isSafeInteger(payload.sender?.id) && (payload.sender?.id ?? 0) > 0
        ? String(payload.sender!.id)
        : undefined,
  })

  for (const projectId of new Set(
    [...result.created, ...result.skipped].map((item) => item.projectId),
  )) {
    await notifyProject(projectId)
    notifyAfterProjectUpdate(projectId)
  }
  return Response.json({ ok: true, ...result })
}
