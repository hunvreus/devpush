export const apiErrorMessages = {
  NOT_FOUND: 'The resource was not found.',
  IDEMPOTENCY_REQUIRED: 'Provide an Idempotency-Key for this operation.',
  IDEMPOTENCY_CONFLICT:
    'This idempotency key was already used with different input.',
  SETTINGS_CONFLICT:
    'The resource settings changed. Read its current settings version and try again.',
  OPERATION_CONFLICT:
    'The operation could not be admitted in the current resource state.',
  METHOD_NOT_ALLOWED: 'This HTTP method is not supported for this resource.',
  INVALID_CURSOR: 'The cursor is invalid or belongs to a different query.',
  UNSUPPORTED_MEDIA_TYPE: 'Use application/json for the request body.',
  REQUEST_TOO_LARGE: 'The request body is too large.',
} as const

export class ApiError extends Error {
  constructor(
    readonly code: keyof typeof apiErrorMessages,
    readonly status: number,
  ) {
    super(apiErrorMessages[code])
    this.name = 'ApiError'
  }
}
