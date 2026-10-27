import { pluginApiVersion } from './version'
import { validatePluginServices } from './contract'
import type {
  PluginContext,
  PluginServices,
  WorkspaceOperation,
  WorkspaceActor,
} from './contract'

export type {
  CertificateResult,
  DeploymentServer,
  GeneratedHostnameInput,
  RuntimeLogLimits,
  WorkspaceActor,
  WorkspaceOperation,
  PluginContext,
  PluginServices,
  PreparedNotification,
} from './contract'

export interface ServerPlugin {
  apiVersion: typeof pluginApiVersion
  create: (
    environment: Readonly<Record<string, string | undefined>>,
    context: PluginContext,
  ) => PluginServices
}
export interface ServerPluginEntry {
  id: string
  implementation: ServerPlugin
}

export function defineServerPlugin(
  create: ServerPlugin['create'],
): Readonly<ServerPlugin> {
  if (typeof create !== 'function')
    throw new Error('Plugin create must be a function.')
  return Object.freeze({ apiVersion: pluginApiVersion, create })
}

/** Compose trusted static plugins. Core permissions still precede every policy. */
export function composeServerPlugins(
  entries: readonly ServerPluginEntry[],
  environment: Readonly<Record<string, string | undefined>>,
  context: PluginContext,
): PluginServices {
  const environmentSnapshot = Object.freeze({ ...environment })
  const ids = new Set<string>()
  const services = entries.map(({ id, implementation }) => {
    if (ids.has(id)) throw new Error(`Duplicate server plugin: ${id}`)
    ids.add(id)
    if (
      (implementation.apiVersion as number) !== pluginApiVersion ||
      typeof implementation.create !== 'function'
    )
      throw new Error(`Incompatible server plugin: ${id}`)
    return {
      id,
      value: validatePluginServices(
        implementation.create(environmentSnapshot, context),
      ),
    }
  })
  function exclusive<
    TKey extends 'generateHostname' | 'certificates' | 'runtimeLogLimits',
  >(key: TKey): PluginServices[TKey] {
    const providers = services.filter(({ value }) => value[key])
    if (providers.length > 1)
      throw new Error(
        `Conflicting ${key} providers: ${providers.map(({ id }) => id).join(', ')}`,
      )
    return providers[0]?.value[key]
  }
  const policies = services.flatMap(({ id, value }) =>
    value.workspaceAccess ? [{ id, policy: value.workspaceAccess }] : [],
  )
  const lifecycle = services.flatMap(({ value }) =>
    value.serverLifecycle ? [value.serverLifecycle] : [],
  )
  return {
    generateHostname: exclusive('generateHostname'),
    certificates: exclusive('certificates'),
    runtimeLogLimits: exclusive('runtimeLogLimits'),
    ...(policies.length
      ? {
          workspaceAccess: {
            async run<T>(
              input: {
                teamId: string
                operation: WorkspaceOperation
                actor: WorkspaceActor
              },
              action: () => Promise<T>,
            ) {
              const policyInput = Object.freeze({
                ...input,
                actor: Object.freeze({ ...input.actor }),
              })
              let actionSucceeded = false
              const invoke = async (index: number): Promise<T> => {
                const entry = policies[index]
                if (!entry) {
                  const value = await action()
                  actionSucceeded = true
                  return value
                }
                let calls = 0
                let closed = false
                let downstream: Promise<T> | undefined
                try {
                  await entry.policy.run(policyInput, () => {
                    if (calls !== 0)
                      throw new Error(
                        `Plugin ${entry.id} invoked its mutation more than once.`,
                      )
                    if (closed)
                      throw new Error(
                        `Plugin ${entry.id} invoked its mutation after returning.`,
                      )
                    calls++
                    downstream = invoke(index + 1)
                    // Await it below even when a faulty provider forgets to do so.
                    void downstream.catch(() => {})
                    return downstream
                  })
                } catch (error) {
                  closed = true
                  if (downstream) await downstream.catch(() => {})
                  if (actionSucceeded && error instanceof WorkspacePolicyError)
                    throw new Error(
                      `Plugin ${entry.id} rejected an already completed mutation.`,
                    )
                  throw error
                } finally {
                  closed = true
                }
                if (!downstream)
                  throw new Error(
                    `Plugin ${entry.id} did not invoke or reject its mutation.`,
                  )
                return downstream
              }
              return invoke(0)
            },
          },
        }
      : {}),
    ...(lifecycle.length
      ? {
          serverLifecycle: {
            async reconcile(server) {
              for (const service of lifecycle) await service.reconcile(server)
            },
            async maintain() {
              const results = await Promise.allSettled(
                lifecycle.map((service) =>
                  Promise.resolve().then(() => service.maintain()),
                ),
              )
              const failures = results.filter(
                (result) => result.status === 'rejected',
              )
              if (failures.length)
                throw new AggregateError(
                  failures.map((result) => result.reason),
                  'Plugin maintenance failed.',
                )
            },
          },
        }
      : {}),
    async handleRequest(request, session) {
      const id = /^\/api\/plugins\/([^/]+)(?:\/|$)/.exec(
        new URL(request.url).pathname,
      )?.[1]
      const handler = services.find((service) => service.id === id)?.value
        .handleRequest
      return handler
        ? handler(request, session)
        : new Response('Not found', { status: 404 })
    },
  }
}

/** A deliberate policy refusal. Provider/internal errors must use ordinary errors. */
export class WorkspacePolicyError extends Error {
  name = 'WorkspacePolicyError'
  constructor(
    readonly reason: 'restricted' | 'limit' | 'busy',
    readonly publicDetails?: { message: string; recoveryUrl?: string },
  ) {
    super('Workspace policy rejected the operation.')
  }
}

export { workspaceOperations } from './operations'
