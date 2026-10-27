import type { WorkspaceOperation, WorkspaceActor } from './operations'

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

interface DeploymentWorkspace {
  createdAt: number
  personalOwnerId?: string | null
  image?: string | null
  color?: string
  id: string
  slug: string
  name: string
  status: string
  serverCount: number
  /** Latest server creation/deletion timestamp, independent of heartbeats. */
  serverCountChangedAt?: number
  memberCount: number
}

export type { WorkspaceOperation, WorkspaceActor } from './operations'

export interface PreparedNotification {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

export interface PluginContext {
  defer?: (work: () => Promise<unknown>) => void
  /** Render once before persisting a retryable transactional notification. */
  prepareNotification?: (input: {
    userId: string
    subject: string
    message: string
    action?: { label: string; url: string }
  }) => Promise<PreparedNotification | null>
  /** Generic transactional delivery: recipient policy belongs to the caller. */
  notifyUser?: (input: {
    userId: string
    subject: string
    message: string
    action?: { label: string; url: string }
    idempotencyKey: string
    prepared?: PreparedNotification
  }) => Promise<boolean>
  listWorkspaceOwners?: (teamId: string) => Promise<string[]>
  reportServerIssue?: (input: {
    serverId: string
    category: 'domains' | 'servers'
    key: string
    title: string
    message: string
    active: boolean
  }) => Promise<void>

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

export interface RuntimeLogLimits {
  bytesPerMinute: number
  bytesPerDay: number
  rowsPerDay: number
}

export interface PluginServices {
  /** Optional installation policy; core authenticates and scopes logs before applying it. */
  runtimeLogLimits?: (teamId: string) => RuntimeLogLimits

  workspaceAccess?: {
    run: <T>(
      input: {
        teamId: string
        operation: WorkspaceOperation
        actor: WorkspaceActor
      },
      action: () => Promise<T>,
    ) => Promise<T>
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

export function validatePluginServices(value: unknown): PluginServices {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Plugin services must be an object.')
  const services = value as Record<string, unknown>
  const allowed = new Set([
    'generateHostname',
    'serverLifecycle',
    'certificates',
    'workspaceAccess',
    'handleRequest',
    'runtimeLogLimits',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error('Unknown devpush plugin service.')
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
    !hasMethods(services.workspaceAccess, ['run'])
  )
    throw new Error('Invalid workspace access service.')
  if (
    services.handleRequest !== undefined &&
    typeof services.handleRequest !== 'function'
  )
    throw new Error('Invalid plugin request service.')
  if (
    services.runtimeLogLimits !== undefined &&
    typeof services.runtimeLogLimits !== 'function'
  )
    throw new Error('Invalid runtime log limits service.')
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
