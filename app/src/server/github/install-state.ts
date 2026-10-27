import { jwtVerify, SignJWT } from 'jose'

import { config } from '#devpush/server/config'
import { getSafeRedirectPath } from '#devpush/lib/internal-redirect'

const audience = 'devpush:github-installation'
const issuer = 'devpush'

export async function createGitHubInstallState({
  next,
  userId,
}: {
  next: string
  userId: string
}) {
  return new SignJWT({ next: getSafeRedirectPath(next), userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(audience)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti(crypto.randomUUID())
    .sign(secret())
}

export async function verifyGitHubInstallState({
  state,
  userId,
}: {
  state: string
  userId: string
}) {
  const { payload } = await jwtVerify(state, secret(), {
    algorithms: ['HS256'],
    audience,
    issuer,
  })

  if (payload.userId !== userId || typeof payload.next !== 'string') {
    throw new Error('Invalid GitHub installation state.')
  }

  return getSafeRedirectPath(payload.next)
}

function secret() {
  return new TextEncoder().encode(config.BETTER_AUTH_SECRET)
}
