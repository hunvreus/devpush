/** Keep browser and social titles consistent across route heads. */
export function pageHead(...parts: Array<string | undefined>) {
  const context = parts.filter((part) => part?.trim()).join(' – ')
  const title = context ? `${context} | devpush` : 'devpush'

  return {
    meta: [
      { title },
      { name: 'title', content: title },
      { property: 'og:title', content: title },
      { name: 'twitter:title', content: title },
    ],
  }
}
