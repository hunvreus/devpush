import { createHmac } from 'node:crypto'

import { beforeEach, expect, test, vi } from 'vitest'

import { handleGitHubWebhook } from './webhook-handler'

vi.mock('#devpush/server/notifications/observe', () => ({
  notifyAfterProjectUpdate: vi.fn().mockResolvedValue(undefined),
}))

const mocks = vi.hoisted(() => ({
  deploy: vi.fn(),
  installation: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('#devpush/server/config', () => ({
  config: { GITHUB_APP_WEBHOOK_SECRET: 'secret' },
}))
vi.mock('#devpush/server/github/service', () => ({
  handleGitHubInstallationWebhook: mocks.installation,
}))
vi.mock('#devpush/server/projects/deployments', () => ({
  createDeploymentsForGitHubPush: mocks.deploy,
}))
vi.mock('#devpush/server/http/rate-limit', () => ({
  enforceRateLimit: mocks.limit,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deploy.mockResolvedValue({ created: [], skipped: [] })
  mocks.limit.mockResolvedValue(null)
})

function delivery(payload: unknown, event = 'push', valid = true) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const signature = valid
    ? createHmac('sha256', 'secret').update(body).digest('hex')
    : '0'.repeat(64)
  return new Request('https://example.test/api/github/webhook', {
    method: 'POST',
    body,
    headers: {
      'x-github-delivery': 'delivery-1',
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${signature}`,
    },
  })
}

test('signed pushes bypass IP throttling and preserve commit metadata', async () => {
  mocks.limit.mockResolvedValue(new Response(null, { status: 429 }))
  const response = await handleGitHubWebhook(
    delivery({
      ref: 'refs/heads/main',
      sender: { id: 12345 },
      installation: { id: 1 },
      repository: { id: 2, full_name: 'acme/app' },
      head_commit: {
        id: 'abc123',
        message: 'Push',
        author: { name: 'Ada' },
        timestamp: '2026-10-12T01:00:00Z',
        url: 'https://github.com/acme/app/commit/abc123',
      },
    }),
  )
  expect(response.status).toBe(200)
  expect(mocks.limit).not.toHaveBeenCalled()
  expect(mocks.deploy).toHaveBeenCalledWith(
    expect.objectContaining({
      githubSenderId: '12345',
      authorName: 'Ada',
      authoredAt: '2026-10-12T01:00:00Z',
      commitUrl: 'https://github.com/acme/app/commit/abc123',
    }),
  )
})

test('invalid signatures consume the unauthenticated rate limit', async () => {
  mocks.limit.mockResolvedValue(new Response(null, { status: 429 }))
  expect((await handleGitHubWebhook(delivery({}, 'push', false))).status).toBe(
    429,
  )
  expect(mocks.limit).toHaveBeenCalledOnce()
  expect(mocks.deploy).not.toHaveBeenCalled()
})

test('malformed signed installation deliveries return a typed client error', async () => {
  expect(
    (await handleGitHubWebhook(delivery('{', 'installation'))).status,
  ).toBe(400)
  expect((await handleGitHubWebhook(delivery({}, 'installation'))).status).toBe(
    400,
  )
  expect(mocks.installation).not.toHaveBeenCalled()
})
