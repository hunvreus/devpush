export function getErrorMessage(error: unknown, fallback: string) {
  const message = getMessage(error)
  if (!message) return fallback
  return presentMessage(
    error,
    getValidationErrorMessage(message) ?? message,
    fallback,
  )
}

export function getFieldErrorMessage({
  error,
  fallback,
  field,
}: {
  error: unknown
  fallback: string
  field: string
}) {
  const message = getMessage(error)
  if (!message) return fallback

  const validationIssue = getValidationIssues(message).find((issue) => {
    const path = issue.path ?? []
    return path.at(-1) === field || path.join('.') === field
  })

  return presentMessage(
    error,
    validationIssue?.message ?? getValidationErrorMessage(message) ?? message,
    fallback,
  )
}

function presentMessage(error: unknown, message: string, fallback: string) {
  const status = getStatus(error)
  if (status !== undefined && status >= 500) return fallback
  if (status === 429)
    return 'Too many attempts. Please wait a moment and try again.'
  if (
    /^(failed to fetch|fetch failed|load failed|networkerror\b|network request failed)/i.test(
      message,
    )
  ) {
    return 'Unable to connect. Check your connection and try again.'
  }
  // Framework, database, and provider diagnostics belong in logs. Callers
  // supply the action-specific explanation; keep business validation intact.
  if (
    /^(HTTPError|Error|Unknown error|Internal server error|Internal error|Something went wrong|Bad gateway|Service unavailable|Gateway timeout)[.!]?$/i.test(
      message,
    ) ||
    /^(Failed query:|D1_|SQLITE_|LibsqlError|Resend failed to send email:|TypeError:|ReferenceError:|SyntaxError:|Cannot read properties of|Unexpected token|Unexpected end of JSON|<!doctype|<html)/i.test(
      message,
    ) ||
    /\n\s+at\s/.test(message)
  )
    return fallback
  return message
}

function getStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('statusCode' in error && typeof error.statusCode === 'number')
    return error.statusCode
  return undefined
}

function getMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message.trim()
  }

  return ''
}

function getValidationErrorMessage(message: string) {
  const issue = getValidationIssues(message).find((item) => item.message)
  return issue?.message ?? null
}

function getValidationIssues(message: string): Array<{
  message?: string
  path?: Array<string | number>
}> {
  try {
    const issues = JSON.parse(message) as unknown
    if (!Array.isArray(issues)) return []

    return issues.filter(
      (
        item,
      ): item is {
        message?: string
        path?: Array<string | number>
      } => {
        if (!item || typeof item !== 'object') return false
        if ('message' in item && typeof item.message !== 'string') return false
        if (!('path' in item)) return true
        if (!Array.isArray(item.path)) return false

        const path: Array<unknown> = item.path
        return path.every(
          (part) => typeof part === 'string' || typeof part === 'number',
        )
      },
    )
  } catch {
    return []
  }
}
