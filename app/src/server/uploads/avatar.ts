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

export function parseAvatarDataUrl(dataUrl: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)

  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error('Upload a PNG, JPEG, or WebP image.')
  }

  const mimeType = match[1]
  const buffer = Buffer.from(match[2], 'base64')

  if (buffer.byteLength > 2 * 1024 * 1024) {
    throw new Error('Avatars must be 2 MB or smaller.')
  }

  if (!matchesImageSignature(buffer, mimeType)) {
    throw new Error('The uploaded file does not match its image type.')
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
