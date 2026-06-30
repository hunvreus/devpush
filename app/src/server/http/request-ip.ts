export function getRequestPublicAddress(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const firstForwardedAddress = forwardedFor?.split(',').at(0)?.trim()

  if (firstForwardedAddress) {
    return stripPort(firstForwardedAddress)
  }

  const realIp = request.headers.get('x-real-ip')?.trim()

  if (realIp) {
    return stripPort(realIp)
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
