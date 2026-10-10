export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (
    'code' in error &&
    (error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
  )
    return true
  // D1 includes SQLite's failure in its message rather than a native code.
  if (
    'message' in error &&
    typeof error.message === 'string' &&
    /UNIQUE constraint failed:/i.test(error.message)
  )
    return true
  return 'cause' in error && isUniqueConstraintError(error.cause)
}
