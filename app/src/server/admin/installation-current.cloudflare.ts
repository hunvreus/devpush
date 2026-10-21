import { getWorkerVersionMetadata } from '@/server/runtime/platform-env'
import type { InstallationInfo } from './installation'

export async function readCurrentInstallation(): Promise<
  InstallationInfo['current']
> {
  const workerVersion = getWorkerVersionMetadata()
  if (workerVersion) {
    return {
      arch: null,
      distro: 'Cloudflare Workers',
      distroVersion: null,
      gitCommit: workerVersion.id,
      gitRef: workerVersion.tag || workerVersion.id,
      installId: workerVersion.id,
      updatedAt: null,
    }
  }

  return null
}
