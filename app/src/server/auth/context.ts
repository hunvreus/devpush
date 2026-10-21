import { config } from '@/server/config'
import { createServerFn } from '@tanstack/react-start'
import { getAuthMethods } from '@/server/auth/auth-methods'
import { getAuthSession } from '@/server/auth/session.server'
import { getUserContext } from '@/server/teams/service'

export type AuthUserContext = Awaited<ReturnType<typeof getUserContext>>
export const getLoginContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getAuthSession()

    return {
      authMethods: getAuthMethods(),
      signInMessage: config.DEVPUSH_SIGN_IN_MESSAGE,
      userContext: session ? await getUserContext(session.user.id) : null,
    }
  },
)

export const getCurrentUserContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    return getUserContext(session.user.id)
  },
)
