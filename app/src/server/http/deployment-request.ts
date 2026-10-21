import { getAuthSession } from '@/server/auth/session.server'
import { getDeploymentServices } from '@/deployment/services.server'

export async function handleDeploymentRequest(request: Request) {
  const handler = getDeploymentServices().handleRequest
  if (!handler) return new Response('Not found', { status: 404 })
  const session = await getAuthSession()
  return handler(
    request,
    session ? { userId: session.user.id, email: session.user.email } : null,
  )
}
