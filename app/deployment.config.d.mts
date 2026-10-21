export function resolveServerDeployment(
  environment: { DEVPUSH_DEPLOYMENT_SERVER?: string; DEVPUSH_DEPLOYMENT_UI?: string },
  rootDirectory: string,
): {
  server: string
  clientDirectory: string
  directory: string
  aliases: Array<{ find: string | RegExp; replacement: string }>
}

export function deploymentStylesSource(clientDirectory: string, rootDirectory: string): string
