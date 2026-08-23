import { getObjectStore } from '@/server/storage/object-store'

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
  filePrefix: string
  resourceId: string
}) {
  if (!avatarDataUrl && !deleteAvatar) {
    return currentAvatarPath
  }

  if (deleteAvatar || !avatarDataUrl) {
    if (currentAvatarPath) {
      await removePublicFile(currentAvatarPath)
    }

    return null
  }

  const parsed = parseAvatarDataUrl(avatarDataUrl)
  const fileName = `${filePrefix}_${resourceId}.${parsed.extension}`
  const publicPath = `/uploads/avatars/${fileName}`

  await getObjectStore().put(
    `avatars/${fileName}`,
    parsed.buffer,
    parsed.mimeType,
  )

  if (currentAvatarPath && currentAvatarPath !== publicPath) {
    await removePublicFile(currentAvatarPath)
  }

  return publicPath
}

function parseAvatarDataUrl(dataUrl: string) {
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl,
    )

  if (!match) {
    throw new Error('Upload a PNG, JPEG, GIF, or WebP image.')
  }

  const mimeType = match[1]
  const buffer = Buffer.from(match[2], 'base64')

  if (buffer.byteLength > 2 * 1024 * 1024) {
    throw new Error('Avatars must be 2 MB or smaller.')
  }

  return {
    buffer,
    mimeType,
    extension:
      mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/gif'
            ? 'gif'
            : 'webp',
  }
}

export async function removePublicFile(publicPath: string | null | undefined) {
  if (!publicPath) {
    return
  }

  if (!publicPath.startsWith('/uploads/avatars/')) {
    return
  }

  try {
    await getObjectStore().delete(publicPath.slice('/uploads/'.length))
  } catch {
    // Missing old avatar files should not block saving settings.
  }
}
