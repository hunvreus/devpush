import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { apiKeyPresetSchema } from '#devpush/lib/api-key-schema'
import { publicErrorsMiddleware } from '#devpush/server/http/public-errors'
import {
  completeMcpConsent,
  getMcpConsent,
  listMcpConnections,
  revokeMcpConnection,
} from './connections'

const querySchema = z
  .object({ oauthQuery: z.string().min(1).max(16384) })
  .strict()
const consentSchema = querySchema
  .extend({
    accepted: z.boolean(),
    teamId: z.string().min(1).max(128).optional(),
    projectIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(100)
      .nullable()
      .optional(),
    preset: apiKeyPresetSchema.default('read'),
    includeLogs: z.boolean().default(false),
  })
  .strict()
export const getMcpConsentAction = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => querySchema.parse(data))
  .handler(({ data }) =>
    getMcpConsent({ ...data, headers: getRequest().headers }),
  )
export const completeMcpConsentAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => consentSchema.parse(data))
  .handler(({ data }) =>
    completeMcpConsent({ ...data, headers: getRequest().headers }),
  )
export const getMcpConnectionsAction = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) =>
    z
      .object({ page: z.number().int().min(1).max(1_000_000).default(1) })
      .strict()
      .parse(data ?? {}),
  )
  .handler(({ data }) =>
    listMcpConnections({ ...data, headers: getRequest().headers }),
  )
export const revokeMcpConnectionAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) =>
    z
      .object({ id: z.string().min(1).max(128) })
      .strict()
      .parse(data),
  )
  .handler(({ data }) =>
    revokeMcpConnection({ ...data, headers: getRequest().headers }),
  )
