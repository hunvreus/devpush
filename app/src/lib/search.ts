export function stringSearchValidator<const TKey extends string>(
  keys: ReadonlyArray<TKey>,
) {
  return (search: Record<string, unknown>): Partial<Record<TKey, string>> => {
    const result: Partial<Record<TKey, string>> = {}

    for (const key of keys) {
      const value = search[key]
      if (typeof value === 'string') result[key] = value
    }

    return result
  }
}
