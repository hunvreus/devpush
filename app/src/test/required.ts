// Fail at the missing fixture/query result, before assertions dereference it.
export function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected a fixture or query result.')
  return value
}
