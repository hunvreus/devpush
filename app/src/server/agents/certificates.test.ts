import { beforeEach, expect, test, vi } from 'vitest'
import { requestAgentCertificate } from './certificates'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  services: vi.fn(),
  readServer: vi.fn(),
  request: vi.fn(),
  reconcile: vi.fn(),
}))
vi.mock('#devpush/server/servers/service', () => ({
  requireAgentServer: mocks.authorize,
}))
vi.mock('#devpush/server/plugins/services.server', () => ({
  getPluginServices: mocks.services,
}))
vi.mock('#devpush/server/plugins/server-context', () => ({
  pluginContext: { readServer: mocks.readServer },
}))
const server = {
  id: 'server',
  teamId: 'team',
  teamSlug: 'acme',
  teamStatus: 'active',
  status: 'connected',
  handle: 'web',
  publicAddress: '1.2.3.4',
  publicIpv4: '1.2.3.4',
  publicIpv6: null,
}
const input = {
  serverId: 'server',
  token: 'agent-secret',
  csrPem: 'signed-csr',
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.services.mockReturnValue({
    certificates: { request: mocks.request },
    serverLifecycle: { reconcile: mocks.reconcile },
  })
  mocks.readServer.mockResolvedValue(server)
})

test('does not call private code if agent authentication fails', async () => {
  mocks.authorize.mockRejectedValue(new Error('unauthorized'))
  await expect(requestAgentCertificate(input)).rejects.toThrow('unauthorized')
  expect(mocks.services).not.toHaveBeenCalled()
  expect(mocks.request).not.toHaveBeenCalled()
})

test('OSS authenticates then reports managed certificates unavailable', async () => {
  mocks.services.mockReturnValue({})
  await expect(requestAgentCertificate(input)).rejects.toMatchObject({
    status: 404,
  })
  expect(mocks.request).not.toHaveBeenCalled()
})

test.each(['deleted', 'disabled'])(
  'denies %s servers even with a valid credential',
  async (status) => {
    mocks.readServer.mockResolvedValue({ ...server, status })
    await expect(requestAgentCertificate(input)).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.request).not.toHaveBeenCalled()
  },
)

test('returns pending with Retry-After without passing agent credentials to the private service', async () => {
  mocks.request.mockResolvedValue({ status: 'pending', retryAfter: 12 })
  const response = await requestAgentCertificate(input)
  expect(response.status).toBe(202)
  expect(response.headers.get('retry-after')).toBe('12')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.request).toHaveBeenCalledWith({ server, csrPem: input.csrPem })
})

test('returns a public chain and rejects accidental private-key fields', async () => {
  const result = {
    status: 'ready',
    certificatePem:
      '-----BEGIN CERTIFICATE-----\ncHVibGlj\n-----END CERTIFICATE-----\n',
    expiresAt: '2027-01-01T00:00:00Z',
  }
  mocks.request.mockResolvedValue(result)
  expect(await (await requestAgentCertificate(input)).json()).toEqual(result)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const invalid of [
    { ...result, privateKey: 'must-not-leak' },
    {
      ...result,
      certificatePem:
        result.certificatePem +
        '-----BEGIN PRIVATE KEY-----\nmust-not-leak\n-----END PRIVATE KEY-----',
    },
  ]) {
    mocks.request.mockResolvedValue(invalid)
    await expect(requestAgentCertificate(input)).rejects.toMatchObject({
      status: 503,
    })
  }
  expect(log.mock.calls.flat().join(' ')).not.toContain('must-not-leak')
  log.mockRestore()
})

test('returns only the authenticated server wildcard configuration before receiving a CSR', async () => {
  const result = {
    status: 'configuration',
    dnsNames: ['*.web-acme.devpush.app'],
  }
  mocks.request.mockResolvedValue(result)
  const response = await requestAgentCertificate({
    serverId: input.serverId,
    token: input.token,
  })
  expect(await response.json()).toEqual(result)
  expect(mocks.request).toHaveBeenCalledWith({ server, csrPem: undefined })
  expect(response.headers.get('cache-control')).toBe('no-store')
})
