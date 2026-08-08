import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createFileRoute } from '@tanstack/react-router'

const avatarNamePattern =
  /^(?:user|team|project)_[A-Za-z0-9-]+\.(?:png|jpe?g|webp)$/

export const Route = createFileRoute('/uploads/avatars/$fileName')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!avatarNamePattern.test(params.fileName)) {
          return new Response('Not found.', { status: 404 })
        }

        try {
          const content = await readFile(
            path.join(
              process.cwd(),
              'public',
              'uploads',
              'avatars',
              params.fileName,
            ),
          )
          return new Response(content, {
            headers: {
              'cache-control': 'public, max-age=3600',
              'content-type': contentType(params.fileName),
            },
          })
        } catch {
          return new Response('Not found.', { status: 404 })
        }
      },
    },
  },
})

function contentType(fileName: string) {
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}
