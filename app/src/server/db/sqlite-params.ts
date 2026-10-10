export function sqliteParams(
  params: unknown[],
): Array<string | number | bigint | Uint8Array | null> {
  return params.map((value) => {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'boolean') return Number(value)
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      value instanceof Uint8Array
    )
      return value
    throw new Error(
      'Unsupported SQLite bound parameter; encode values at the schema boundary.',
    )
  })
}
