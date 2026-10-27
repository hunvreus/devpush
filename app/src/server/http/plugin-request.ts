import { getAuthSession } from '#devpush/server/auth/session.server'
import { getPluginServices } from '#devpush/server/plugins/services.server'

export async function handlePluginRequest(request: Request) {
  const session = await getAuthSession()
  return getPluginServices().handleRequest!(
    request,
    session
      ? {
          userId: session.user.id,
          email: session.user.email,
        }
      : null,
  )
}
