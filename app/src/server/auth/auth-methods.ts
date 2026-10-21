import { config } from '@/server/config'

export type AuthMethods = {
  email: boolean
  github: boolean
  google: boolean
}

export function getGitHubOAuthCredentials() {
  const clientId = config.GITHUB_APP_CLIENT_ID
  const clientSecret = config.GITHUB_APP_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return null
  }

  return { clientId, clientSecret }
}

export function getAuthMethods(): AuthMethods {
  const githubCredentials = getGitHubOAuthCredentials()

  return {
    email: Boolean(config.EMAIL_FROM && config.RESEND_API_KEY),
    github: Boolean(githubCredentials),
    google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  }
}
