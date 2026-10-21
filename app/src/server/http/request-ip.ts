import { config } from '@/server/config'
import { isCloudflareRuntime } from '@/server/runtime/platform-env'

type AddressTrust = {
  cloudflare: boolean
  proxy: boolean
  header?: 'x-forwarded-for' | 'x-real-ip'
}

export function getRequestPublicAddress(
  request: Request,
  trust: AddressTrust = {
    cloudflare: isCloudflareRuntime(),
    proxy: config.DEVPUSH_TRUST_PROXY,
  },
) {
  if (trust.cloudflare) {
    const cloudflareAddress = request.headers.get('cf-connecting-ip')?.trim()

    return cloudflareAddress ? stripPort(cloudflareAddress) : null
  }

  if (!trust.proxy) {
    const runtimeAddress = (request as Request & { readonly ip?: unknown }).ip

    return typeof runtimeAddress === 'string' && runtimeAddress.trim()
      ? stripPort(runtimeAddress.trim())
      : null
  }

  // Trust one configured header only. Never fall back to another header the
  // proxy may have passed through unchanged from an untrusted client.
  const header = trust.header ?? config.DEVPUSH_CLIENT_IP_HEADER
  const value = request.headers.get(header)?.trim()
  const address =
    header === 'x-forwarded-for' ? value?.split(',').at(-1)?.trim() : value
  return address ? stripPort(address) : null
}

function stripPort(value: string) {
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')

    return closingBracket > 0 ? value.slice(1, closingBracket) : value
  }

  const parts = value.split(':')

  if (parts.length === 2 && /^\d+$/.test(parts[1] ?? '')) {
    return parts[0] ?? value
  }

  return value
}
