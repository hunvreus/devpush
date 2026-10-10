import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, eq, gt, sql } from 'drizzle-orm'
import { decodeJwt } from 'jose'

import { getAuthMethods, getGitHubOAuthCredentials } from '@/lib/auth/config'
import { db } from '@/server/db'
import { replacePendingIdentity } from '@/server/auth/provider-identity'
import * as schema from '@/server/db/schema'
import {
  assertEmailCanAuthenticate,
  assertUserCanCreateSession,
} from '@/server/auth/access'
import {
  sendEmailChangeEmail,
  sendEmailVerificationEmail,
  sendOtpEmail,
} from '@/server/email/service'
import { config } from '@/server/config'
import { requireAuthEmailDelivery } from '@/server/auth/email-delivery'
import { ensureUserBootstrap } from '@/server/teams/service'
import { decryptSecret, encryptSecret } from '@/server/secrets/crypto'

export const authMethods = getAuthMethods()
const githubCredentials = getGitHubOAuthCredentials()

type ProviderIdentity = {
  name?: string | null
  email?: string | null
  username?: string | null
  image?: string | null
}

type OAuthTokens = {
  accessToken?: string
  idToken?: string
}

type GitHubProfile = {
  id: number | string
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}

type GitHubEmail = {
  email: string
  primary: boolean
  verified: boolean
}

const pendingProviderIdentityTtlMs = 5 * 60 * 1000

export const auth = betterAuth({
  appName: 'devpush',
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  basePath: '/api/auth',
  advanced: {
    cookiePrefix: 'devpush',
  },
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  user: {
    additionalFields: {
      defaultTeamId: {
        type: 'string',
        required: false,
        input: false,
      },
      username: {
        type: 'string',
        required: false,
        input: false,
      },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ newEmail, url, user }) => {
        await sendEmailChangeEmail({
          currentEmail: user.email,
          newEmail,
          verifyUrl: url,
        })
      },
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ url, user }) => {
      await sendEmailVerificationEmail({
        email: user.email,
        verifyUrl: url,
      })
    },
  },
  databaseHooks: {
    account: {
      create: {
        before: async (createdAccount) => {
          const identity = await readPendingProviderIdentity(
            getProviderIdentityKey(
              createdAccount.providerId,
              createdAccount.accountId,
            ),
          )

          if (!identity) {
            return
          }

          return {
            data: {
              providerAccountName: identity.name ?? undefined,
              providerAccountEmail: identity.email ?? undefined,
              providerAccountUsername: identity.username ?? undefined,
              providerAccountImage: identity.image ?? undefined,
            },
          }
        },
        after: async (createdAccount) => {
          await clearPendingProviderIdentity(
            getProviderIdentityKey(
              createdAccount.providerId,
              createdAccount.accountId,
            ),
          )
        },
      },
    },
    session: {
      create: {
        before: async (createdSession) => {
          await assertUserCanCreateSession(createdSession.userId)
        },
      },
    },
    user: {
      create: {
        before: async (createdUser) => {
          await assertEmailCanAuthenticate(createdUser.email)

          return {
            data: {
              username: await getAvailableUsername(
                createdUser.name || createdUser.email,
              ),
            },
          }
        },
        after: async (createdUser) => {
          try {
            await ensureUserBootstrap(createdUser.id)
          } catch (error) {
            console.error('Failed to bootstrap user', error)
          }
        },
      },
    },
  },
  socialProviders: {
    ...(githubCredentials
      ? {
          github: {
            clientId: githubCredentials.clientId,
            clientSecret: githubCredentials.clientSecret,
            getUserInfo: getGitHubUserInfo,
          },
        }
      : {}),
    ...(authMethods.google
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID as string,
            clientSecret: config.GOOGLE_CLIENT_SECRET as string,
            getUserInfo: getGoogleUserInfo,
          },
        }
      : {}),
  },
  account: {
    additionalFields: {
      providerAccountName: {
        type: 'string',
        required: false,
        input: false,
      },
      providerAccountEmail: {
        type: 'string',
        required: false,
        input: false,
      },
      providerAccountUsername: {
        type: 'string',
        required: false,
        input: false,
      },
      providerAccountImage: {
        type: 'string',
        required: false,
        input: false,
      },
    },
    accountLinking: {
      allowDifferentEmails: false,
      enabled: true,
      trustedProviders: ['github', 'google'],
    },
  },
  plugins: [
    requireAuthEmailDelivery(),
    ...(authMethods.email
      ? [
          emailOTP({
            allowedAttempts: 5,
            expiresIn: 300,
            resendStrategy: 'reuse',
            storeOTP: 'encrypted',
            sendVerificationOTP: async ({ email, otp, type }) => {
              if (type !== 'sign-in') {
                return
              }

              await assertEmailCanAuthenticate(email)
              await sendOtpEmail(email, otp)
            },
          }),
        ]
      : []),
    tanstackStartCookies(),
  ],
})

function getProviderIdentityKey(providerId: string, accountId: string) {
  return `${providerId}:${accountId}`
}

async function rememberProviderIdentity({
  accountId,
  providerId,
  identity,
}: {
  accountId: string
  providerId: string
  identity: ProviderIdentity
}) {
  const key = getProviderIdentityKey(providerId, accountId)
  const identifier = pendingProviderIdentityIdentifier(key)

  await replacePendingIdentity(db, {
    identifier,
    value: encryptSecret(JSON.stringify(identity)),
    expiresAt: new Date(Date.now() + pendingProviderIdentityTtlMs),
  })
}

async function readPendingProviderIdentity(key: string) {
  const identifier = pendingProviderIdentityIdentifier(key)
  const rows = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(
      and(
        eq(schema.verification.identifier, identifier),
        gt(schema.verification.expiresAt, new Date()),
      ),
    )
    .limit(1)
  const value = rows[0]?.value

  if (!value) {
    return null
  }

  try {
    const identity = JSON.parse(decryptSecret(value)) as unknown
    return isProviderIdentity(identity) ? identity : null
  } catch {
    await clearPendingProviderIdentity(key)
    return null
  }
}

async function clearPendingProviderIdentity(key: string) {
  await db
    .delete(schema.verification)
    .where(
      eq(
        schema.verification.identifier,
        pendingProviderIdentityIdentifier(key),
      ),
    )
}

function pendingProviderIdentityIdentifier(key: string) {
  return `devpush:provider-identity:${key}`
}

function isProviderIdentity(value: unknown): value is ProviderIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return ['name', 'email', 'username', 'image'].every((field) => {
    const item = (value as Record<string, unknown>)[field]
    return item === undefined || item === null || typeof item === 'string'
  })
}

async function getGitHubUserInfo(token: OAuthTokens) {
  if (!token.accessToken) {
    return null
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token.accessToken}`,
    'User-Agent': 'devpush',
  }
  const [userResponse, emailsResponse] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/emails', { headers }),
  ])

  if (!userResponse.ok) {
    return null
  }

  const profile = (await userResponse.json()) as GitHubProfile
  let email = profile.email
  let emailVerified = false

  if (emailsResponse.ok) {
    const emails = (await emailsResponse.json()) as Array<GitHubEmail>
    const primaryEmail =
      emails.find((candidate) => candidate.primary) ?? emails.at(0)
    email = email ?? primaryEmail?.email ?? null
    emailVerified =
      emails.find((candidate) => candidate.email === email)?.verified ?? false
  }

  await assertEmailCanAuthenticate(email)

  const accountId = String(profile.id)

  await rememberProviderIdentity({
    accountId,
    providerId: 'github',
    identity: {
      name: profile.name,
      email,
      username: profile.login,
      image: profile.avatar_url,
    },
  })

  return {
    user: {
      id: accountId,
      name: profile.name || profile.login || '',
      email,
      image: profile.avatar_url ?? undefined,
      emailVerified,
    },
    data: profile,
  }
}

async function getGoogleUserInfo(token: OAuthTokens) {
  if (!token.idToken) {
    return null
  }

  const claims = decodeJwt(token.idToken)
  const accountId = getStringClaim(claims.sub)
  const email = getStringClaim(claims.email)
  const name = getStringClaim(claims.name)
  const image = getStringClaim(claims.picture)

  if (!accountId) {
    return null
  }

  await assertEmailCanAuthenticate(email)

  await rememberProviderIdentity({
    accountId,
    providerId: 'google',
    identity: {
      name,
      email,
      username: email,
      image,
    },
  })

  return {
    user: {
      id: accountId,
      name,
      email,
      image,
      emailVerified: claims.email_verified === true,
    },
    data: claims,
  }
}

function getStringClaim(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

async function getAvailableUsername(value: string) {
  const base = normalizeUsername(value)
  const existingRows = await db
    .select({ username: schema.user.username })
    .from(schema.user)
    .where(
      and(
        sql`lower(${schema.user.username}) = ${base}`,
        eq(schema.user.status, 'active'),
      ),
    )
    .limit(1)

  if (existingRows.length === 0) {
    return base
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomUUID().slice(0, 8)
    const candidate = `${base.slice(0, 41)}-${suffix}`
    const rows = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(
          eq(schema.user.username, candidate),
          eq(schema.user.status, 'active'),
        ),
      )
      .limit(1)

    if (rows.length === 0) {
      return candidate
    }
  }

  return `user-${crypto.randomUUID().slice(0, 12)}`
}

function normalizeUsername(value: string) {
  const username = value
    .split('@')[0]
    ?.toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 50)
    .replace(/[._-]+$/g, '')

  return username || `user-${crypto.randomUUID().slice(0, 12)}`
}
