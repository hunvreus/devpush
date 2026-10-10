import { config } from '@/server/config'
import { isCloudflareRuntime } from '@/server/runtime/platform-env'

type AddressTrust = {
  cloudflare: boolean
  proxy: boolean
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

  const realIp = request.headers.get('x-real-ip')?.trim()

  if (realIp) {
    return stripPort(realIp)
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const firstForwardedAddress = forwardedFor?.split(',').at(0)?.trim()

  if (firstForwardedAddress) {
    return stripPort(firstForwardedAddress)
  }

  return null
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
