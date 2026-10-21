import { config } from '@/server/config'
import { isCloudflareRuntime } from '@/server/runtime/platform-env'

export function resolveProxyRequest(
  request: Request,
  options = {
    trusted: config.DEVPUSH_TRUST_PROXY && !isCloudflareRuntime(),
    origins: [
      config.DEVPUSH_BASE_URL,
      config.BETTER_AUTH_URL,
      config.DEVPUSH_MCP_URL,
    ],
  },
): Request {
  if (!options.trusted) return request
  const protocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',')
    .at(-1)
    ?.trim()
    .toLowerCase()
  if (protocol !== 'http' && protocol !== 'https') return request
  const current = new URL(request.url)
  const host =
    request.headers.get('x-forwarded-host')?.split(',').at(-1)?.trim() ??
    current.host
  let origin: URL
  try {
    origin = new URL(`${protocol}://${host}`)
  } catch {
    return request
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    return request
  if (!options.origins.some((value) => new URL(value).origin === origin.origin))
    return request
  if (current.origin === origin.origin) return request
  const url = new URL(current.pathname + current.search, origin)
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: request.redirect,
    duplex: 'half',
  } as RequestInit)
}
