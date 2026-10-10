import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, test, vi } from 'vitest'

describe('GitHub webhooks', () => {
  afterEach(() => {
    delete process.env.GITHUB_APP_WEBHOOK_SECRET
    vi.resetModules()
  })

  test('verifies sha256 webhook signatures', async () => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'webhook-secret'
    vi.resetModules()

    const { verifyGitHubWebhookSignature } = await import('./webhooks')
    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const signature =
      'sha256=' +
      createHmac('sha256', 'webhook-secret').update(body).digest('hex')

    expect(verifyGitHubWebhookSignature({ body, signature })).toBe(true)
    expect(
      verifyGitHubWebhookSignature({
        body,
        signature: `${signature.slice(0, -1)}${
          signature.endsWith('0') ? '1' : '0'
        }`,
      }),
    ).toBe(false)
  })

  test('validates required webhook headers before reading the body', async () => {
    const { validateGitHubWebhookHeaders } = await import('./webhooks')
    const valid = new Headers({
      'x-github-delivery': '12345678-1234-1234-1234-123456789abc',
      'x-github-event': 'push',
      'x-hub-signature-256': `sha256=${'a'.repeat(64)}`,
    })

    expect(validateGitHubWebhookHeaders(valid)).toEqual({
      ok: true,
      deliveryId: '12345678-1234-1234-1234-123456789abc',
      event: 'push',
      signature: `sha256=${'a'.repeat(64)}`,
    })
    expect(validateGitHubWebhookHeaders(new Headers())).toMatchObject({
      ok: false,
      status: 401,
    })
    valid.set('x-hub-signature-256', 'sha256=not-hex')
    expect(validateGitHubWebhookHeaders(valid)).toMatchObject({
      ok: false,
      status: 401,
    })
    valid.set('x-hub-signature-256', `sha256=${'a'.repeat(64)}`)
    valid.delete('x-github-delivery')
    expect(validateGitHubWebhookHeaders(valid)).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  test('extracts branch names from push refs', async () => {
    const { getBranchFromGitHubRef } = await import('./webhooks')

    expect(getBranchFromGitHubRef('refs/heads/main')).toBe('main')
    expect(getBranchFromGitHubRef('refs/tags/v1')).toBeNull()
    expect(getBranchFromGitHubRef(undefined)).toBeNull()
  })

  test('rejects non-object payloads', async () => {
    const { parseGitHubPushPayload } = await import('./webhooks')

    expect(() => parseGitHubPushPayload('null')).toThrow(
      'Invalid GitHub webhook payload.',
    )
  })

  test('parses installation lifecycle payloads', async () => {
    const { parseGitHubInstallationWebhookPayload } = await import('./webhooks')

    expect(
      parseGitHubInstallationWebhookPayload(
        JSON.stringify({ action: 'renamed', installation: { id: 123 } }),
      ),
    ).toEqual({ action: 'renamed', installationId: 123 })
    expect(() =>
      parseGitHubInstallationWebhookPayload(
        JSON.stringify({ action: 'renamed', installation: {} }),
      ),
    ).toThrow('Invalid GitHub installation webhook payload.')
  })

  test('maps installation lifecycle events to metadata changes', async () => {
    const { getGitHubInstallationChange } = await import('./webhooks')

    expect(getGitHubInstallationChange('installation', 'deleted')).toEqual({
      type: 'status',
      status: 'deleted',
    })
    expect(getGitHubInstallationChange('installation', 'suspend')).toEqual({
      type: 'status',
      status: 'suspended',
    })
    expect(getGitHubInstallationChange('installation', 'unsuspend')).toEqual({
      type: 'refresh',
    })
    expect(
      getGitHubInstallationChange('installation_target', 'renamed'),
    ).toEqual({ type: 'refresh' })
    expect(
      getGitHubInstallationChange('installation_repositories', 'removed'),
    ).toEqual({ type: 'refresh' })
  })
})
