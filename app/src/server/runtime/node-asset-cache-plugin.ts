import { definePlugin } from 'nitro'

export function preventAssetErrorCaching(response: Response, url: URL) {
  if (response.status >= 400 && url.pathname.startsWith('/assets/'))
    response.headers.set('Cache-Control', 'no-store')
}

export default definePlugin((app) => {
  app.hooks.hook('response', (response, event) => {
    preventAssetErrorCaching(response, new URL(event.req.url))
  })
})
