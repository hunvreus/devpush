import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { config } from '@/server/config'

export type InstallationInfo = {
  current: {
    arch: string | null
    distro: string | null
    distroVersion: string | null
    gitCommit: string | null
    gitRef: string
    installId: string | null
    updatedAt: string | null
  } | null
  latest: {
    checkedAt: string
    error: string | null
    isUpdateAvailable: boolean
    tag: string | null
    url: string | null
  } | null
}

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

const tagSchema = z.array(
  z.object({
    name: z.string(),
  }),
)

const versionFilePath =
  config.DEVPUSH_VERSION_FILE ?? '/var/lib/devpush/version.json'
const cacheTtlMs = 5 * 60 * 1000
const requestTimeoutMs = 3_000

let latestTagCache:
  | {
      checkedAt: number
      error: string | null
      tag: string | null
    }
  | undefined

export async function getInstallationInfo(): Promise<InstallationInfo> {
  const current = await readCurrentInstallation()

  if (!current) {
    return {
      current: null,
      latest: null,
    }
  }

  const latestTag = await getLatestReleaseTag()
  const isUpdateAvailable = Boolean(
    latestTag.tag && !isSameVersion(latestTag.tag, current.gitRef),
  )

  return {
    current,
    latest: {
      checkedAt: new Date(latestTag.checkedAt).toISOString(),
      error: latestTag.error,
      isUpdateAvailable,
      tag: latestTag.tag,
      url:
        latestTag.tag && isUpdateAvailable
          ? `https://github.com/hunvreus/devpush/releases/tag/${latestTag.tag}`
          : null,
    },
  }
}

async function readCurrentInstallation(): Promise<InstallationInfo['current']> {
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

async function getLatestReleaseTag() {
  const now = Date.now()

  if (latestTagCache && now - latestTagCache.checkedAt < cacheTtlMs) {
    return latestTagCache
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    const response = await fetch(
      'https://api.github.com/repos/hunvreus/devpush/tags?per_page=50',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'devpush-admin-version-check',
        },
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}.`)
    }

    const tags = tagSchema.parse(await response.json())
    const latestTag =
      tags.find((tag) => /^v?\d+\.\d+\.\d+$/.test(tag.name))?.name ?? null

    latestTagCache = {
      checkedAt: now,
      error: null,
      tag: latestTag,
    }
  } catch (error) {
    latestTagCache = {
      checkedAt: now,
      error:
        error instanceof Error
          ? error.message
          : 'Could not retrieve latest version.',
      tag: null,
    }
  } finally {
    clearTimeout(timeout)
  }

  return latestTagCache
}

function isSameVersion(left: string, right: string) {
  return stripVersionPrefix(left) === stripVersionPrefix(right)
}

function stripVersionPrefix(value: string) {
  return value.trim().replace(/^v/, '')
}
