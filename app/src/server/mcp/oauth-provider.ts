import { getCurrentAuthEndpointContext } from '@better-auth/core/context'
import { getOAuthProviderApi, oauthProvider } from '@better-auth/oauth-provider'
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BetterAuthPlugin } from 'better-auth'
import {
  apiKeyPresetSchema,
  scopesForApiPreset,
} from '#devpush/lib/api-key-schema'

import { config } from '#devpush/server/config'
import { db } from '#devpush/server/db'
import { apiGrants, oauthConsent } from '#devpush/server/db/schema'
import { resolveApiGrant } from '#devpush/server/api/credentials'
import { oauthDiscoveryPlugins } from '#devpush/server/mcp/oauth-discovery'

export const mcpResource = config.DEVPUSH_MCP_URL
export const mcpOAuthScopes = [
  'devpush:read',
  'devpush:deploy',
  'devpush:manage',
  'devpush:logs',
  'offline_access',
] as const

const options = {
  loginPage: '/auth/login',
  consentPage: '/oauth/consent',
  scopes: [...mcpOAuthScopes],
  resources: [
    {
      identifier: mcpResource,
      name: 'devpush MCP',
      accessTokenTtl: 600,
      allowedScopes: [...mcpOAuthScopes],
    },
  ],
  clientRegistrationDefaultResources: [mcpResource],
  grantTypes: ['authorization_code', 'refresh_token'] as [
    'authorization_code',
    'refresh_token',
  ],
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationRequirePKCE: true,
  // Provider-owned opaque tokens allow immediate token-family revocation.
  // Locally verified JWTs remain valid after refresh-token replay otherwise.
  disableJwtPlugin: true,
  clientPrivileges: async () => false,
  accessTokenExpiresIn: 600,
  refreshTokenExpiresIn: 30 * 24 * 60 * 60,
  postLogin: {
    page: '/oauth/consent',
    shouldRedirect: async () => false,
    consentReferenceId: async ({ user }: { user: { id: string } }) => {
      const ctx = getCurrentAuthEndpointContext()
      const grantId = ctx.headers?.get('x-devpush-mcp-grant')
      if (!grantId) return undefined
      const principal = await resolveApiGrant(grantId)
      const query = new URLSearchParams(ctx.body?.oauth_query ?? '')
      const clientId = query.get('client_id')
      const [grant] = await db
        .select()
        .from(apiGrants)
        .where(eq(apiGrants.id, grantId))
        .limit(1)
      if (
        principal.userId !== user.id ||
        !clientId ||
        grant?.providerGrantId !== clientId
      )
        throw new APIError('FORBIDDEN', {
          message: 'Invalid MCP authorization.',
        })
      return grantId
    },
  },
  customAccessTokenClaims: async ({
    user,
    referenceId,
    resources,
  }: {
    user?: { id: string } | null
    referenceId?: string
    resources?: string[]
  }) => {
    if (
      !user ||
      !referenceId ||
      resources?.length !== 1 ||
      resources[0] !== mcpResource
    )
      throw new APIError('FORBIDDEN', {
        message: 'MCP authorization is required.',
      })
    const principal = await resolveApiGrant(referenceId)
    if (principal.userId !== user.id)
      throw new APIError('FORBIDDEN', { message: 'Invalid MCP authorization.' })
    return { devpush_grant_id: referenceId }
  },
} satisfies Parameters<typeof oauthProvider>[0]

function mcpOAuthBridge() {
  return {
    id: 'devpush-mcp-authorization',
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/oauth2/register',
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body
            // Desktop MCP clients omit application_type. Infer native only for
            // public clients whose callbacks all use exact HTTP loopback hosts;
            // the provider still validates each URI and requires PKCE.
            if (
              body?.application_type === undefined &&
              body?.token_endpoint_auth_method === 'none' &&
              Array.isArray(body.redirect_uris) &&
              body.redirect_uris.length > 0 &&
              body.redirect_uris.every(
                (uri: unknown) =>
                  typeof uri === 'string' &&
                  /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/|$)/i.test(
                    uri,
                  ),
              )
            )
              return {
                context: { body: { ...body, application_type: 'native' } },
              }
          }),
        },
        {
          matcher: (ctx) => ctx.path === '/oauth2/authorize',
          handler: createAuthMiddleware(async (ctx) => {
            // Every browser connection chooses its own resource grant. A previous
            // client's consent must not silently select an unrelated team.
            if (!ctx.headers?.has('x-devpush-mcp-grant')) {
              const prompt = new Set(
                String(ctx.query?.prompt ?? '')
                  .split(' ')
                  .filter(Boolean),
              )
              prompt.add('consent')
              return {
                context: {
                  query: { ...ctx.query, prompt: [...prompt].join(' ') },
                },
              }
            }
          }),
        },
      ],
    },
    endpoints: {
      verifyMcpAccessToken: createAuthEndpoint(
        '/mcp/verify',
        {
          method: 'POST',
          body: z.object({ token: z.string().min(1).max(8192) }),
        },
        async (ctx) => {
          const claims = await getOAuthProviderApi(
            ctx,
            options,
          ).requireActiveAccessToken(ctx.body.token)
          const audience =
            typeof claims.aud === 'string' ? [claims.aud] : claims.aud
          if (
            !audience?.includes(mcpResource) ||
            typeof claims.devpush_grant_id !== 'string' ||
            typeof claims.sub !== 'string'
          )
            throw new APIError('UNAUTHORIZED', {
              message: 'Invalid MCP access token.',
            })
          const principal = await resolveApiGrant(claims.devpush_grant_id)
          const [grant] = await db
            .select()
            .from(apiGrants)
            .where(eq(apiGrants.id, principal.credentialId))
            .limit(1)
          const clientId = claims.client_id ?? claims.azp
          const [consent] = await db
            .select({ id: oauthConsent.id })
            .from(oauthConsent)
            .where(
              and(
                eq(oauthConsent.referenceId, principal.credentialId),
                eq(oauthConsent.userId, principal.userId),
                eq(oauthConsent.clientId, String(clientId)),
              ),
            )
            .limit(1)
          if (
            claims.sub !== principal.userId ||
            grant?.providerGrantId !== clientId ||
            !consent
          )
            throw new APIError('UNAUTHORIZED', {
              message: 'This MCP connection is no longer authorized.',
            })
          const tokenScopes = new Set(
            typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
          )
          const permittedScopes = new Set<string>(
            apiKeyPresetSchema.options.flatMap((preset) =>
              tokenScopes.has(`devpush:${preset}`)
                ? scopesForApiPreset(
                    preset,
                    principal.roleCeiling,
                    tokenScopes.has('devpush:logs'),
                  )
                : [],
            ),
          )
          if (permittedScopes.size === 0)
            throw new APIError('UNAUTHORIZED', {
              message: 'MCP access permissions are required.',
            })
          return {
            ...principal,
            scopes: principal.scopes.filter((scope) =>
              permittedScopes.has(scope),
            ),
          }
        },
      ),
    },
  } satisfies BetterAuthPlugin
}

export function mcpOAuthPlugins() {
  return [
    oauthProvider(options),
    ...oauthDiscoveryPlugins(),
    mcpOAuthBridge(),
  ] as const
}
