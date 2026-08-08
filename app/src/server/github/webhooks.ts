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

export function verifyGitHubWebhookSignature({
  body,
  signature,
}: {
  body: string
  signature: string | null
}) {
  if (!config.GITHUB_APP_WEBHOOK_SECRET) {
    throw new Error('GitHub webhook secret is not configured.')
  }

  if (!signature?.startsWith('sha256=')) {
    return false
  }

  const expected = createHmac('sha256', config.GITHUB_APP_WEBHOOK_SECRET)
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
