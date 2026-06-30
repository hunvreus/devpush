export function routeUrl({
  host,
  https,
}: {
  host: string
  https: boolean
}) {
  return `${https ? 'https' : 'http'}://${host}`
}
