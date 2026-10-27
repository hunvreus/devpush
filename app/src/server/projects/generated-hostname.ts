import { z } from 'zod'
import { PublicError } from '#devpush/lib/public-error'
import { getPluginServices } from '#devpush/server/plugins/services.server'
import { pluginContext } from '#devpush/server/plugins/server-context'
import type {
  GeneratedHostname,
  GeneratedHostnameInput,
} from '#devpush/plugins/contract'
import {
  buildDefaultHostForProject,
  buildDefaultHostForEnvironment,
  buildBranchAliasHostname,
  buildDeploymentAliasHostname,
  generatedAliasUsesHttps,
} from './hostnames'

type HostnameRequest = Omit<GeneratedHostnameInput, 'server' | 'kind'> & {
  serverId: string
  serverPublicAddress: string | null
} & (
    | { kind: 'project' }
    | { kind: 'environment'; environmentSlug: string }
    | { kind: 'branch'; branch: string }
    | { kind: 'deployment'; deploymentId: string }
  )

const generatedHostnameSchema = z.strictObject({
  hostname: z
    .string()
    .min(1)
    .max(253)
    .refine(
      (value) =>
        value.includes('.') &&
        value
          .split('.')
          .every(
            (label) =>
              label.length <= 63 &&
              /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
          ),
    ),
  https: z.boolean(),
})

export async function resolveGeneratedHostname(
  input: HostnameRequest,
): Promise<GeneratedHostname> {
  const services = getPluginServices()
  if (services.generateHostname) {
    const server = await pluginContext.readServer(input.serverId)
    if (
      !server ||
      server.status === 'deleted' ||
      server.status === 'disabled' ||
      server.teamStatus !== 'active'
    )
      throw new PublicError('PROJECT_SERVER_INVALID')
    await services.serverLifecycle?.reconcile(server)
    const {
      serverId: _serverId,
      serverPublicAddress: _address,
      ...request
    } = input
    const result = await services.generateHostname({ ...request, server })
    return generatedHostnameSchema.parse(result)
  }
  const hostname =
    input.kind === 'project'
      ? buildDefaultHostForProject(input)
      : input.kind === 'environment'
        ? buildDefaultHostForEnvironment(input)
        : input.kind === 'branch'
          ? buildBranchAliasHostname(input)
          : buildDeploymentAliasHostname(input)
  return { hostname, https: generatedAliasUsesHttps(input.serverPublicAddress) }
}
