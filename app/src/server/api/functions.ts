import { createServerFn } from '@tanstack/react-start'
import {
  apiKeyIdSchema,
  apiKeySettingsSchema,
  apiKeyTeamsSchema,
  apiKeyProjectsSchema,
  createApiKeySchema,
} from '#devpush/lib/api-key-schema'
import { requireAuthSession } from '#devpush/server/auth/session.server'
import { publicErrorsMiddleware } from '#devpush/server/http/public-errors'
import {
  createApiKey,
  getApiKeySettings,
  getApiKeyTeams,
  getApiKeyProjects,
  revokeApiKey,
  rotateApiKey,
} from './credentials'

export const getApiKeySettingsAction = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => apiKeySettingsSchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    getApiKeySettings((await requireAuthSession()).user.id, undefined, data),
  )

export const createApiKeyAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => createApiKeySchema.parse(data))
  .handler(async ({ data }) =>
    createApiKey((await requireAuthSession()).user.id, data),
  )

export const getApiKeyTeamsAction = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => apiKeyTeamsSchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    getApiKeyTeams((await requireAuthSession()).user.id, data),
  )

export const getApiKeyProjectsAction = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => apiKeyProjectsSchema.parse(data))
  .handler(async ({ data }) =>
    getApiKeyProjects((await requireAuthSession()).user.id, data),
  )

export const rotateApiKeyAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => apiKeyIdSchema.parse(data))
  .handler(async ({ data }) =>
    rotateApiKey((await requireAuthSession()).user.id, data.id),
  )

export const revokeApiKeyAction = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: unknown) => apiKeyIdSchema.parse(data))
  .handler(async ({ data }) =>
    revokeApiKey((await requireAuthSession()).user.id, data.id),
  )
