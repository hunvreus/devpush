import { beforeEach, expect, test, vi } from 'vitest'
import { resolveGeneratedHostname } from './generated-hostname'

const mocks = vi.hoisted(() => ({
  services: vi.fn(),
  readServer: vi.fn(),
  reconcile: vi.fn(),
  generate: vi.fn(),
}))
vi.mock('@/deployment/services.server', () => ({
  getDeploymentServices: mocks.services,
}))
vi.mock('@/deployment/server-context', () => ({
  deploymentContext: { readServer: mocks.readServer },
}))
const server = {
  id: 'server',
  teamId: 'team',
  teamSlug: 'acme',
  teamStatus: 'active',
  status: 'connected',
  handle: 'web-1',
  publicAddress: '192.168.1.2',
  publicIpv4: null,
  publicIpv6: null,
}
const input = {
  kind: 'deployment' as const,
  deploymentId: 'a1234567-rest',
  projectName: 'shop',
  serverId: server.id,
  serverPublicAddress: server.publicAddress,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.services.mockReturnValue({})
  mocks.readServer.mockResolvedValue(server)
})

test('keeps OSS nip.io and HTTP behavior without reading hosted state', async () => {
  await expect(resolveGeneratedHostname(input)).resolves.toEqual({
    hostname: 'a123456-shop-192-168-1-2.nip.io',
    https: false,
  })
  expect(mocks.readServer).not.toHaveBeenCalled()
})

test('uses the authoritative server snapshot and reconciles before resolving a private hostname', async () => {
  mocks.services.mockReturnValue({
    generateHostname: mocks.generate,
    serverLifecycle: { reconcile: mocks.reconcile },
  })
  mocks.generate.mockResolvedValue({
    hostname: 'a123456.web-1-acme.devpush.app',
    https: true,
  })
  await expect(resolveGeneratedHostname(input)).resolves.toEqual({
    hostname: 'a123456.web-1-acme.devpush.app',
    https: true,
  })
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({ server, kind: 'deployment' }),
  )
  expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.generate.mock.invocationCallOrder[0]!,
  )
})

test.each(['disabled', 'deleted'])(
  'rejects %s servers before private side effects',
  async (status) => {
    mocks.services.mockReturnValue({ generateHostname: mocks.generate })
    mocks.readServer.mockResolvedValue({ ...server, status })
    await expect(resolveGeneratedHostname(input)).rejects.toThrow()
    expect(mocks.generate).not.toHaveBeenCalled()
  },
)

test('fails closed for malformed extension output and provisioning failures', async () => {
  mocks.services.mockReturnValue({ generateHostname: mocks.generate })
  mocks.generate.mockResolvedValue({
    hostname: '*.unsafe.example',
    https: true,
    privateKey: 'must-not-pass',
  })
  await expect(resolveGeneratedHostname(input)).rejects.toThrow()
  mocks.generate.mockRejectedValue(new Error('not ready'))
  await expect(resolveGeneratedHostname(input)).rejects.toThrow('not ready')
})
