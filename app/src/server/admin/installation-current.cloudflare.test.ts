import { afterEach, expect, test, vi } from 'vitest'
import { readCurrentInstallation } from './installation-current.cloudflare'

const metadata = vi.hoisted(() => vi.fn())
vi.mock('@/server/runtime/platform-env', () => ({
  getWorkerVersionMetadata: metadata,
}))
afterEach(() => metadata.mockReset())

test('missing Worker metadata yields no installation instead of reading a Node file', async () => {
  metadata.mockReturnValue(undefined)
  expect(await readCurrentInstallation()).toBeNull()
})
test('Worker metadata supplies the installation version', async () => {
  metadata.mockReturnValue({ id: 'version-id', tag: 'v1.2.3' })
  expect(await readCurrentInstallation()).toEqual({
    arch: null,
    distro: 'Cloudflare Workers',
    distroVersion: null,
    gitCommit: 'version-id',
    gitRef: 'v1.2.3',
    installId: 'version-id',
    updatedAt: null,
  })
})
