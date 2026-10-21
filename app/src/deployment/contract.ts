import metadata from '../../deployment-api.json'

export const deploymentApiVersion = metadata.version

export interface DeploymentServer {
  id: string
  teamId: string
  teamSlug: string
  teamStatus: string
  handle: string
  status: string
  publicAddress: string | null
  publicIpv4: string | null
  publicIpv6: string | null
  agentCapabilities?: string[] | null
}

export type GeneratedHostnameInput = {
  server: DeploymentServer
  projectName: string
} & (
  | { kind: 'project' }
  | { kind: 'environment'; environmentSlug: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'deployment'; deploymentId: string }
)

export interface GeneratedHostname {
  hostname: string
  https: boolean
}

export type CertificateResult =
  | { status: 'configuration'; dnsNames: string[] }
  | { status: 'pending'; retryAfter: number }
  | { status: 'ready'; certificatePem: string; expiresAt: string }

export interface DeploymentWorkspace {
  id: string
  slug: string
  name: string
  status: string
  serverCount: number
  memberCount: number
}

export type WorkspaceOperation =
  | 'server.create'
  | 'member.invite'
  | 'member.accept'
  | 'deployment.create'

export interface DeploymentContext {
  readWorkspace?: (teamId: string) => Promise<DeploymentWorkspace | null>
  authorizeWorkspace?: (
    userId: string,
    teamSlug: string,
  ) => Promise<{ id: string; slug: string; name: string; role: string } | null>
  hasServerRouting: (serverId: string) => Promise<boolean>
  readServer: (serverId: string) => Promise<DeploymentServer | null>
  listServers: (input: {
    afterId?: string
    limit: number
  }) => Promise<DeploymentServer[]>
}

export interface DeploymentServices {
  workspaceAccess?: {
    run: <T>(
      input: { teamId: string; operation: WorkspaceOperation },
      action: () => Promise<T>,
    ) => Promise<T>
    connected: (teamId: string) => Promise<void>
  }
  handleRequest?: (
    request: Request,
    session: { userId: string; email: string } | null,
  ) => Promise<Response>

  generateHostname?: (
    input: GeneratedHostnameInput,
  ) => Promise<GeneratedHostname>
  serverLifecycle?: {
    reconcile: (server: DeploymentServer) => Promise<void>
    maintain: () => Promise<void>
  }
  certificates?: {
    request: (input: {
      server: DeploymentServer
      csrPem?: string
      installedCertificateSha256?: string
    }) => Promise<CertificateResult>
  }
}

export interface ServerDeployment {
  apiVersion: typeof deploymentApiVersion
  name: string
  create: (
    environment: Readonly<Record<string, string | undefined>>,
    context: DeploymentContext,
  ) => DeploymentServices
}

export function defineServerDeployment(
  deployment: ServerDeployment,
): ServerDeployment {
  if (deployment.apiVersion !== deploymentApiVersion)
    throw new Error('Incompatible devpush deployment API version.')
  if (!deployment.name.trim() || typeof deployment.create !== 'function')
    throw new Error('Invalid devpush server deployment.')
  return Object.freeze(deployment)
}

export function validateDeploymentServices(value: unknown): DeploymentServices {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Deployment services must be an object.')
  const services = value as Record<string, unknown>
  const allowed = new Set([
    'generateHostname',
    'serverLifecycle',
    'certificates',
    'workspaceAccess',
    'handleRequest',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error('Unknown devpush deployment service.')
  if (
    services.generateHostname !== undefined &&
    typeof services.generateHostname !== 'function'
  )
    throw new Error('Invalid generated hostname service.')
  if (
    services.serverLifecycle !== undefined &&
    !hasMethods(services.serverLifecycle, ['reconcile', 'maintain'])
  )
    throw new Error('Invalid server lifecycle service.')
  if (
    services.certificates !== undefined &&
    !hasMethods(services.certificates, ['request'])
  )
    throw new Error('Invalid certificate service.')
  if (
    services.workspaceAccess !== undefined &&
    !hasMethods(services.workspaceAccess, ['run', 'connected'])
  )
    throw new Error('Invalid workspace access service.')
  if (
    services.handleRequest !== undefined &&
    typeof services.handleRequest !== 'function'
  )
    throw new Error('Invalid deployment request service.')
  return Object.freeze(value)
}

function hasMethods(value: unknown, methods: ReadonlyArray<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).every((key) => methods.includes(key)) &&
    methods.every((key) => typeof record[key] === 'function')
  )
}
