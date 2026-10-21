import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function resolveServerDeployment(environment, rootDirectory) {
  const selected = environment.DEVPUSH_DEPLOYMENT_SERVER?.trim()
  const server = resolve(
    rootDirectory,
    selected || 'src/deployment/default.server.ts',
  )
  if (!existsSync(server))
    throw new Error('The selected devpush server deployment does not exist.')
  const client = resolve(
    rootDirectory,
    environment.DEVPUSH_DEPLOYMENT_UI?.trim() ||
      'src/deployment/default.ui.tsx',
  )
  if (!existsSync(client))
    throw new Error('The selected devpush client deployment does not exist.')
  return {
    server,
    clientDirectory: dirname(client),
    directory: dirname(server),
    aliases: [
      { find: '#devpush/deployment/ui', replacement: client },
      {
        find: /^#devpush\/ui\//,
        replacement: resolve(rootDirectory, 'src/components/ui') + '/',
      },
      { find: '#devpush/deployment/server', replacement: server },
      {
        find: '#devpush/deployment/contract',
        replacement: resolve(rootDirectory, 'src/deployment/contract.ts'),
      },
    ],
  }
}

// Build-time UI contributions can live outside core's automatic Tailwind scan.
export function deploymentStylesSource(clientDirectory, rootDirectory) {
  if (clientDirectory === resolve(rootDirectory, 'src/deployment')) return ''
  return `\n@source ${JSON.stringify(clientDirectory.replaceAll('\\', '/'))};\n`
}
