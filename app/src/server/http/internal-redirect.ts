const internalOrigin = 'https://devpush.invalid'

export function getSafeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/')) {
    return '/'
  }

  try {
    const target = new URL(value, internalOrigin)
    if (target.origin !== internalOrigin) {
      return '/'
    }

    const path = `${target.pathname}${target.search}${target.hash}`

    // Path normalization can produce a protocol-relative string such as `//host`.
    if (new URL(path, internalOrigin).origin !== internalOrigin) {
      return '/'
    }

    return path
  } catch {
    return '/'
  }
}
