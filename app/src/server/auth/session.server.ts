import { getRequest } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'

export async function getAuthSession() {
  const request = getRequest()

  return auth.api.getSession({
    headers: request.headers,
  })
}

export async function requireAuthSession(message = 'Unauthorized') {
  const session = await getAuthSession()

  if (!session) throw new Error(message)

  return session
}
