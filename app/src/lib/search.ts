export function stringSearchValidator<const Key extends string>(
  keys: ReadonlyArray<Key>,
) {
  return (search: Record<string, unknown>): Partial<Record<Key, string>> => {
    const result: Partial<Record<Key, string>> = {}

    for (const key of keys) {
      const value = search[key]
      if (typeof value === 'string') result[key] = value
    }

    return result
  }
}
