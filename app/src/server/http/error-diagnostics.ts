// Keep source locations for investigation without retaining exception messages,
// query text, URLs, or serialized request values. This works on Node and Workers.
export function safeErrorDiagnostics(error: unknown) {
  if (!(error instanceof Error))
    return { errorName: 'unknown', stackFrames: [] as string[] }
  try {
    const errorName = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
      ? error.name
      : 'Error'
    if (typeof error.stack !== 'string')
      return { errorName, stackFrames: [] as string[] }
    // A multiline exception message can itself contain frame-shaped text.
    // Remove the complete message before examining actual stack frames.
    const messagePosition = error.message
      ? error.stack.indexOf(error.message)
      : -1
    const stack =
      messagePosition >= 0
        ? error.stack.slice(messagePosition + error.message.length)
        : error.stack.slice(error.stack.indexOf('\n') + 1)
    const stackFrames: string[] = []
    for (const line of stack.slice(0, 32 * 1024).split('\n')) {
      const match =
        /^\s*at\s+(?:(.*?)\s+\()?([^()\n]+):(\d{1,8}):(\d{1,8})\)?$/.exec(line)
      if (!match) continue
      const source = safeSourceLocation(match[2]!)
      if (!source) continue
      const functionName =
        match[1] &&
        /^(?:(?:async|new) )?[A-Za-z_$][A-Za-z0-9_.$]{0,100}$/.test(match[1])
          ? match[1]
          : undefined
      const location = `${source}:${match[3]}:${match[4]}`
      stackFrames.push(
        functionName ? `at ${functionName} (${location})` : `at ${location}`,
      )
      if (stackFrames.length === 8) break
    }
    return { errorName, stackFrames }
  } catch {
    // Nonstandard error accessors must not prevent the public error response.
    return { errorName: 'Error', stackFrames: [] as string[] }
  }
}

function safeSourceLocation(source: string) {
  if (/^node:[A-Za-z0-9_./-]{1,180}$/.test(source)) return source
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source) &&
    !source.startsWith('file:///') &&
    !/^[A-Za-z]:[\\/]/.test(source)
  )
    return null
  const parts = source
    .replace(/^file:\/\/\//, '/')
    .replace(/\\/g, '/')
    .split('/')
    .slice(-4)
  if (
    !parts.length ||
    parts.some((part) => !/^[A-Za-z0-9_$@.~-]{1,100}$/.test(part))
  )
    return null
  if (!/\.(?:[cm]?js|tsx?|jsx)$/.test(parts.at(-1)!)) return null
  return parts.join('/').slice(-200)
}
