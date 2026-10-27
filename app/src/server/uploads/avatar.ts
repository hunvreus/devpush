import { PublicError } from '#devpush/lib/public-error'
import {
  getObjectStore,
  isObjectStorageConfigured,
} from '#devpush/server/storage/object-store'

export type AvatarOwner = {
  filePrefix: 'user' | 'team' | 'project'
  resourceId: string
}

export async function resolveAvatarUpdate({
  currentAvatarPath,
  avatarDataUrl,
  deleteAvatar,
  filePrefix,
  resourceId,
}: {
  currentAvatarPath: string | null
  avatarDataUrl?: string | null
  deleteAvatar: boolean
  filePrefix: AvatarOwner['filePrefix']
  resourceId: string
}) {
  if (!avatarDataUrl && !deleteAvatar) {
    return currentAvatarPath
  }

  if (deleteAvatar || !avatarDataUrl) {
    return null
  }

  if (!isObjectStorageConfigured()) {
    throw new PublicError('AVATAR_STORAGE_UNAVAILABLE')
  }
  const parsed = parseAvatarDataUrl(avatarDataUrl)
  if (!/^[A-Za-z0-9_-]+$/.test(resourceId))
    throw new Error('Invalid avatar owner.')
  const version = crypto.randomUUID().replaceAll('-', '')
  const fileName = `${filePrefix}_${resourceId}~${version}.${parsed.extension}`
  const publicPath = `/uploads/avatars/${fileName}`

  await getObjectStore().put(
    `avatars/${fileName}`,
    parsed.buffer,
    parsed.mimeType,
  )

  return publicPath
}

function parseAvatarDataUrl(dataUrl: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)

  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new PublicError('AVATAR_TYPE_UNSUPPORTED')
  }

  const mimeType = match[1]
  const buffer = Buffer.from(match[2], 'base64')

  if (buffer.byteLength > 2 * 1024 * 1024) {
    throw new PublicError('AVATAR_TOO_LARGE')
  }

  if (!matchesImageSignature(buffer, mimeType)) {
    throw new PublicError('AVATAR_CONTENT_MISMATCH')
  }

  return {
    buffer,
    mimeType,
    extension:
      mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/png'
          ? 'png'
          : 'webp',
  }
}

function matchesImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/png') {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }

  if (mimeType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    )
  }

  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}

export async function removeOwnedAvatar(
  publicPath: string | null | undefined,
  owner: AvatarOwner,
  options: { strict?: boolean } = {},
) {
  if (!publicPath) {
    return
  }

  if (!publicPath.startsWith('/uploads/avatars/')) {
    return
  }
  const prefix = `/uploads/avatars/${owner.filePrefix}_${owner.resourceId}`
  if (
    !/^[A-Za-z0-9_-]+$/.test(owner.resourceId) ||
    !publicPath.startsWith(prefix)
  )
    return
  const suffix = publicPath.slice(prefix.length)
  if (!/^(?:~[a-f0-9]{32})?\.(?:png|jpe?g|webp)$/.test(suffix)) return

  try {
    await getObjectStore().delete(publicPath.slice('/uploads/'.length))
  } catch (error) {
    if (options.strict) throw error
    // Missing old avatar files should not block saving settings.
  }
}
