const resourceColors = ['lime', 'sky', 'blue', 'green'] as const

export type ResourceColor = (typeof resourceColors)[number]

export function getResourceColor(id: string): ResourceColor {
  let hash = 0

  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return resourceColors[hash % resourceColors.length] ?? resourceColors[0]
}
