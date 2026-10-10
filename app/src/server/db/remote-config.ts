type RemoteConfig = {
  DEVPUSH_DATABASE_URL?: string
  DEVPUSH_LOG_DATABASE_URL?: string
  DEVPUSH_DATABASE_AUTH_TOKEN?: string
  DEVPUSH_LOG_DATABASE_AUTH_TOKEN?: string
}

export function remoteDatabaseConfig(env: RemoteConfig) {
  const main = env.DEVPUSH_DATABASE_URL?.trim()
  const logs = env.DEVPUSH_LOG_DATABASE_URL?.trim()
  if (!main && !logs) {
    if (env.DEVPUSH_DATABASE_AUTH_TOKEN || env.DEVPUSH_LOG_DATABASE_AUTH_TOKEN)
      throw new Error(
        'Database authentication tokens require remote database URLs.',
      )
    return undefined
  }
  if (!main || !logs)
    throw new Error(
      'Configure both DEVPUSH_DATABASE_URL and DEVPUSH_LOG_DATABASE_URL.',
    )
  function identity(value: string) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('Invalid remote database URL.')
    }
    if (
      !['libsql:', 'https:', 'http:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(
        'Remote databases require libsql://, https:// or http:// URLs without embedded credentials or fragments.',
      )
    return `${url.hostname}:${url.port || (url.protocol === 'http:' ? '80' : '443')}${url.pathname.replace(/\/$/, '')}`
  }
  if (identity(main) === identity(logs))
    throw new Error('Main data and logs must use different remote databases.')
  return {
    main: { url: main, authToken: env.DEVPUSH_DATABASE_AUTH_TOKEN },
    logs: { url: logs, authToken: env.DEVPUSH_LOG_DATABASE_AUTH_TOKEN },
  }
}
