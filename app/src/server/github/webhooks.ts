import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/server/config'

export type GitHubPushWebhookPayload = {
  ref?: string
  head_commit?: {
    id?: string
    message?: string
  } | null
  installation?: {
    id?: number
  } | null
  repository?: {
    id?: number
    full_name?: string
  } | null
}

export type GitHubInstallationWebhookPayload = {
  action: string
  installationId: number
}

export type GitHubInstallationWebhookEvent =
  | 'installation'
  | 'installation_repositories'
  | 'installation_target'

export type GitHubInstallationChange =
  | { type: 'refresh' }
  | { type: 'status'; status: 'deleted' | 'suspended' }
  | { type: 'ignore' }

type GitHubWebhookHeadersResult =
  | {
      ok: true
      deliveryId: string
      event: string
      signature: string
    }
  | { ok: false; error: string; status: 400 | 401 }

export function validateGitHubWebhookHeaders(
  headers: Headers,
): GitHubWebhookHeadersResult {
  const signature = headers.get('x-hub-signature-256')?.trim() ?? ''
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, error: 'Invalid signature.', status: 401 }
  }

  const deliveryId = headers.get('x-github-delivery')?.trim() ?? ''
  if (!/^[a-z0-9-]{1,255}$/i.test(deliveryId)) {
    return {
      ok: false,
      error: 'Missing or invalid GitHub delivery ID.',
      status: 400,
    }
  }

  const event = headers.get('x-github-event')?.trim() ?? ''
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(event)) {
    return {
      ok: false,
      error: 'Missing or invalid GitHub event.',
      status: 400,
    }
  }

  return { ok: true, deliveryId, event, signature }
}

export function requireGitHubWebhookConfiguration() {
  if (!config.GITHUB_APP_WEBHOOK_SECRET) {
    throw new Error('GitHub webhook secret is not configured.')
  }

  return config.GITHUB_APP_WEBHOOK_SECRET
}

export function verifyGitHubWebhookSignature({
  body,
  signature,
}: {
  body: string
  signature: string | null
}) {
  const webhookSecret = requireGitHubWebhookConfiguration()

  if (!signature?.startsWith('sha256=')) {
    return false
  }

  const expected = createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex')
  const actual = signature.slice('sha256='.length)

  return safeEqualHex(actual, expected)
}

export function parseGitHubPushPayload(body: string): GitHubPushWebhookPayload {
  const payload: unknown = JSON.parse(body)

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid GitHub webhook payload.')
  }

  return payload
}

export function parseGitHubInstallationWebhookPayload(
  body: string,
): GitHubInstallationWebhookPayload {
  const payload: unknown = JSON.parse(body)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid GitHub installation webhook payload.')
  }

  const record = payload as Record<string, unknown>
  const installation = record.installation

  if (
    typeof record.action !== 'string' ||
    !installation ||
    typeof installation !== 'object' ||
    Array.isArray(installation)
  ) {
    throw new Error('Invalid GitHub installation webhook payload.')
  }

  const installationId = (installation as Record<string, unknown>).id

  if (
    typeof installationId !== 'number' ||
    !Number.isSafeInteger(installationId)
  ) {
    throw new Error('Invalid GitHub installation webhook payload.')
  }

  return { action: record.action, installationId }
}

export function getGitHubInstallationChange(
  event: GitHubInstallationWebhookEvent,
  action: string,
): GitHubInstallationChange {
  if (event === 'installation') {
    if (action === 'deleted') {
      return { type: 'status', status: 'deleted' }
    }

    if (action === 'suspend') {
      return { type: 'status', status: 'suspended' }
    }

    if (
      !['created', 'new_permissions_accepted', 'unsuspend'].includes(action)
    ) {
      return { type: 'ignore' }
    }
  }

  return { type: 'refresh' }
}

export function getBranchFromGitHubRef(ref: string | undefined) {
  const prefix = 'refs/heads/'

  if (!ref?.startsWith(prefix)) {
    return null
  }

  return ref.slice(prefix.length)
}

function safeEqualHex(actualHex: string, expectedHex: string) {
  if (
    !/^[a-f0-9]+$/i.test(actualHex) ||
    actualHex.length !== expectedHex.length
  ) {
    return false
  }

  return timingSafeEqual(
    Buffer.from(actualHex, 'hex'),
    Buffer.from(expectedHex, 'hex'),
  )
}
