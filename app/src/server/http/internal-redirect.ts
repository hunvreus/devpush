const internalOrigin = 'https://devpush.invalid'

export function getSafeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/')) {
    return '/'
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return '/'
  }

  if (decoded.startsWith('//') || decoded.includes('\\')) {
    return '/'
  }

  try {
    const target = new URL(value, internalOrigin)
    if (target.origin !== internalOrigin) {
      return '/'
    }

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return '/'
  }
}
