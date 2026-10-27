import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { config } from '#devpush/server/config'
import type { InstallationInfo } from './installation'

const versionFileSchema = z
  .object({
    arch: z.string().optional(),
    distro: z.string().optional(),
    distro_version: z.string().optional(),
    git_commit: z.string().optional(),
    git_ref: z.string().optional(),
    install_id: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough()

const versionFilePath =
  config.DEVPUSH_VERSION_FILE ?? '/var/lib/devpush/version.json'

export async function readCurrentInstallation(): Promise<
  InstallationInfo['current']
> {
  try {
    const raw = await readFile(versionFilePath, 'utf8')
    const versionInfo = versionFileSchema.parse(JSON.parse(raw))

    if (!versionInfo.git_ref) {
      return null
    }

    return {
      arch: versionInfo.arch ?? null,
      distro: versionInfo.distro ?? null,
      distroVersion: versionInfo.distro_version ?? null,
      gitCommit: versionInfo.git_commit ?? null,
      gitRef: versionInfo.git_ref,
      installId: versionInfo.install_id ?? null,
      updatedAt: versionInfo.updated_at ?? null,
    }
  } catch {
    return null
  }
}
