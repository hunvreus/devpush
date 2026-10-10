import { createFileRoute } from '@tanstack/react-router'

import { getObjectStore } from '@/server/storage/object-store'

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
          const content = await getObjectStore().get(
            `avatars/${params.fileName}`,
          )
          return new Response(new Uint8Array(content.body), {
            headers: {
              'cache-control': 'public, max-age=3600',
              'content-type':
                content.contentType ?? contentType(params.fileName),
              'x-content-type-options': 'nosniff',
            },
          })
        } catch (error) {
          console.error('Unable to read avatar object', {
            error,
            fileName: params.fileName,
          })
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
