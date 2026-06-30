import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

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
  const directory = path.join(process.cwd(), 'public', 'uploads', 'avatars')
  const fileName = `${filePrefix}_${resourceId}.${parsed.extension}`
  const publicPath = `/uploads/avatars/${fileName}`

  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, fileName), parsed.buffer)

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
    await unlink(path.join(process.cwd(), 'public', publicPath))
  } catch {
    // Missing old avatar files should not block saving settings.
  }
}
