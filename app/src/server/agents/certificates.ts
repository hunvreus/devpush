import { z } from 'zod'
import { getDeploymentServices } from '@/deployment/services.server'
import { deploymentContext } from '@/deployment/server-context'
import { requireAgentServer } from '@/server/servers/service'
import { AgentRequestError } from './protocol'

export const certificateRequestSchema = z.strictObject({
  serverId: z.string().min(1).max(128),
  token: z.string().min(1).max(1024),
  csrPem: z.string().min(1).max(16384).optional(),
  installedCertificateSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})

const resultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('configuration'),
    dnsNames: z
      .array(
        z
          .string()
          .max(253)
          .regex(
            /^\*\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
          ),
      )
      .length(1),
  }),
  z.strictObject({
    status: z.literal('pending'),
    retryAfter: z.number().int().min(1).max(3600),
  }),
  z.strictObject({
    status: z.literal('ready'),
    certificatePem: z
      .string()
      .min(1)
      .max(65536)
      .regex(
        /^(?:-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*)+$/,
      ),
    expiresAt: z.iso.datetime(),
  }),
])

export async function requestAgentCertificate(
  input: z.infer<typeof certificateRequestSchema>,
) {
  await requireAgentServer({ serverId: input.serverId, token: input.token })
  const services = getDeploymentServices()
  if (!services.certificates)
    throw new AgentRequestError(404, 'Managed certificates are not configured.')
  const server = await deploymentContext.readServer(input.serverId)
  if (
    !server ||
    server.status === 'deleted' ||
    server.status === 'disabled' ||
    server.teamStatus !== 'active'
  )
    throw new AgentRequestError(403, 'Server is not active.')
  try {
    await services.serverLifecycle?.reconcile(server)
    const result = resultSchema.parse(
      await services.certificates.request({
        server,
        csrPem: input.csrPem,
        ...(input.installedCertificateSha256
          ? { installedCertificateSha256: input.installedCertificateSha256 }
          : {}),
      }),
    )
    return Response.json(
      result,
      result.status === 'pending'
        ? {
            status: 202,
            headers: {
              'Retry-After': String(result.retryAfter),
              'Cache-Control': 'no-store',
            },
          }
        : { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    console.error('Agent certificate provider failed.', { serverId: server.id })
    throw new AgentRequestError(
      503,
      'Certificate service is temporarily unavailable.',
    )
  }
}
