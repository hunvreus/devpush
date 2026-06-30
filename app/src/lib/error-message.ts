export function getErrorMessage(error: unknown, fallback: string) {
  const message = getMessage(error)
  if (!message) return fallback

  return getValidationErrorMessage(message) ?? message
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

  return (
    validationIssue?.message ?? getValidationErrorMessage(message) ?? message
  )
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
