import { and, desc, eq } from 'drizzle-orm'
import { createPrivateKey } from 'node:crypto'
import { SignJWT } from 'jose'

import { config } from '@/server/config'
import { db } from '@/server/db'
import { account, githubInstallations, projects } from '@/server/db/schema'
import { getGitHubInstallationChange } from '@/server/github/webhooks'
import type { GitHubInstallationWebhookEvent } from '@/server/github/webhooks'

const githubApiBaseUrl = 'https://api.github.com'
const composeCandidates = [
  'compose.yml',
  'compose.yaml',
  'docker-compose.yml',
  'docker-compose.yaml',
]

export type GitHubAccount = {
  login: string
  accessToken: string
}

export type GitHubInstallation = {
  id: number
  accountId: number
  accountLogin: string
  accountType: string
  repositorySelection: string
  status: 'active' | 'suspended'
}

export type GitHubRepository = {
  id: number
  installationId: number
  name: string
  fullName: string
  owner: string
  private: boolean
  defaultBranch: string
  updatedAt: string
  permissions: {
    push: boolean
  }
}

type GitHubUserResponse = {
  login: string
}

type GitHubInstallationResponse = {
  id: number
  account: {
    id: number
    login: string
    type: string
  }
  repository_selection: string
  suspended_at?: string | null
}

type GitHubInstallationsResponse = {
  installations: Array<GitHubInstallationResponse>
  total_count: number
}

type GitHubRepositoryResponse = {
  id: number
  name: string
  full_name: string
  private: boolean
  default_branch: string
  updated_at: string
  owner: {
    login: string
  }
  permissions?: {
    push?: boolean
  }
}

type GitHubBranchResponse = {
  commit: {
    sha: string
    commit?: {
      message?: string
    }
  }
}

type GitHubBranchListResponse = Array<{
  name: string
}>

type GitHubCommitResponse = {
  sha: string
  commit?: {
    message?: string
    author?: {
      date?: string
      name?: string
    }
  }
  html_url?: string
}

type GitHubRepositoriesResponse = {
  repositories: Array<GitHubRepositoryResponse>
  total_count: number
}

type GitHubContentResponse =
  | {
      type: 'file'
      content: string
      encoding: string
    }
  | {
      type: string
      content?: string
      encoding?: string
    }

let cachedJwt: { token: string; expiresAt: number } | null = null

export function isGitHubAppConfigured() {
  return Boolean(
    config.GITHUB_APP_ID &&
    config.GITHUB_APP_NAME &&
    config.GITHUB_APP_PRIVATE_KEY,
  )
}

export function getGitHubAppInstallUrl() {
  if (!config.GITHUB_APP_NAME) {
    return null
  }

  return `https://github.com/apps/${config.GITHUB_APP_NAME}/installations/new`
}

export async function getGitHubAccount(
  userId: string,
): Promise<GitHubAccount | null> {
  const accountRows = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')))
    .orderBy(desc(account.updatedAt))
    .limit(1)
  const githubAccount = accountRows.at(0)

  if (!githubAccount?.accessToken) {
    return null
  }

  const user = await githubRequest<GitHubUserResponse>(
    '/user',
    githubAccount.accessToken,
  )

  return {
    login: user.login,
    accessToken: githubAccount.accessToken,
  }
}

export async function listUserInstallations(
  accessToken: string,
): Promise<Array<GitHubInstallation>> {
  const installations: Array<GitHubInstallation> = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const data = await githubRequest<GitHubInstallationsResponse>(
      `/user/installations?per_page=100&page=${page}`,
      accessToken,
    )

    installations.push(
      ...data.installations.map((installation) => ({
        id: installation.id,
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
        status: 'active' as const,
      })),
    )

    if (data.installations.length < 100 || page * 100 >= data.total_count) {
      hasMore = false
    } else {
      page += 1
    }
  }

  return installations
}

export async function listInstallationRepositories({
  accessToken,
  installationId,
}: {
  accessToken: string
  installationId: number
}): Promise<Array<GitHubRepository>> {
  const repositories: Array<GitHubRepository> = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const data = await githubRequest<GitHubRepositoriesResponse>(
      `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      accessToken,
    )

    repositories.push(
      ...data.repositories.map((repo) => mapRepository(repo, installationId)),
    )

    if (data.repositories.length < 100 || page * 100 >= data.total_count) {
      hasMore = false
    } else {
      page += 1
    }
  }

  return repositories
}

export async function getGitHubRepository(
  accessToken: string,
  fullName: string,
  installationId: number,
): Promise<GitHubRepository> {
  const repo = await githubRequest<GitHubRepositoryResponse>(
    `/repos/${encodeURIComponentRepoName(fullName)}`,
    accessToken,
  )

  return mapRepository(repo, installationId)
}

export async function detectComposePath({
  accessToken,
  repo,
  ref,
}: {
  accessToken: string
  repo: string
  ref: string
}) {
  for (const path of composeCandidates) {
    const response = await fetch(
      `${githubApiBaseUrl}/repos/${encodeURIComponentRepoName(repo)}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      {
        headers: githubHeaders(accessToken),
      },
    )

    if (response.status === 404) {
      continue
    }

    if (!response.ok) {
      throw new Error(await readGitHubError(response))
    }

    return path
  }

  return null
}

export async function getRepositoryFileText({
  accessToken,
  path,
  ref,
  repo,
}: {
  accessToken: string
  path: string
  ref: string
  repo: string
}) {
  const data = await githubRequest<GitHubContentResponse>(
    `/repos/${encodeURIComponentRepoName(repo)}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(ref)}`,
    accessToken,
  )

  if (data.type !== 'file' || !data.content) {
    throw new Error(`${path} is not a file.`)
  }

  if (data.encoding !== 'base64') {
    throw new Error(`${path} has unsupported encoding.`)
  }

  return Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8')
}

export async function getBranchHeadCommit({
  accessToken,
  branch,
  repo,
}: {
  accessToken: string
  branch: string
  repo: string
}) {
  if (
    config.DEVPUSH_SMOKE_GITHUB_TOKEN &&
    accessToken === config.DEVPUSH_SMOKE_GITHUB_TOKEN
  ) {
    return {
      sha: 'smoke-branch-head',
      message: `Smoke commit for ${repo}@${branch}`,
    }
  }

  const data = await githubRequest<GitHubBranchResponse>(
    `/repos/${encodeURIComponentRepoName(repo)}/branches/${encodeURIComponent(branch)}`,
    accessToken,
  )

  return {
    sha: data.commit.sha,
    message: data.commit.commit?.message ?? null,
  }
}

export async function listBranchCommits({
  accessToken,
  branch,
  perPage = 5,
  repo,
}: {
  accessToken: string
  branch: string
  perPage?: number
  repo: string
}) {
  const data = await githubRequest<Array<GitHubCommitResponse>>(
    `/repos/${encodeURIComponentRepoName(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
    accessToken,
  )

  return data.map(mapCommit)
}

export async function listRepositoryBranches({
  accessToken,
  repo,
}: {
  accessToken: string
  repo: string
}) {
  if (
    config.DEVPUSH_SMOKE_GITHUB_TOKEN &&
    accessToken === config.DEVPUSH_SMOKE_GITHUB_TOKEN
  ) {
    return ['main']
  }

  const branches: Array<string> = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const data = await githubRequest<GitHubBranchListResponse>(
      `/repos/${encodeURIComponentRepoName(repo)}/branches?per_page=100&page=${page}`,
      accessToken,
    )

    branches.push(...data.map((branch) => branch.name))

    hasMore = data.length === 100
    page += 1
  }

  return branches
}

export async function getAppInstallation(installationId: number) {
  const jwt = await getGitHubAppJwt()

  const installation = await githubRequest<GitHubInstallationResponse>(
    `/app/installations/${installationId}`,
    jwt,
  )

  return mapInstallation(installation)
}

async function getRepositoryAppInstallation(repositoryFullName: string) {
  const jwt = await getGitHubAppJwt()
  const installation = await githubRequest<GitHubInstallationResponse>(
    `/repos/${encodeURIComponentRepoName(repositoryFullName)}/installation`,
    jwt,
  )

  return mapInstallation(installation)
}

export async function createInstallationAccessToken({
  installationId,
  repositoryId,
  repositoryFullName,
}: {
  installationId: number
  repositoryId: number | null
  repositoryFullName: string
}) {
  if (config.DEVPUSH_SMOKE_GITHUB_TOKEN) {
    return {
      token: config.DEVPUSH_SMOKE_GITHUB_TOKEN,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }
  }

  try {
    return await requestInstallationAccessToken({
      installationId,
      repositoryId,
    })
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) {
      throw error
    }

    const installation = await getRepositoryAppInstallation(repositoryFullName)

    if (installation.id === installationId) {
      throw error
    }

    await upsertGitHubInstallation(installation)
    await db
      .update(projects)
      .set({
        githubInstallationId: installation.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projects.githubInstallationId, installationId),
          eq(projects.githubRepo, repositoryFullName),
        ),
      )
    await markGitHubInstallationStatus(installationId, 'deleted')

    return requestInstallationAccessToken({
      installationId: installation.id,
      repositoryId,
    })
  }
}

export async function upsertGitHubInstallation(
  installation: GitHubInstallation,
) {
  await db
    .insert(githubInstallations)
    .values({
      installationId: installation.id,
      accountId: installation.accountId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      status: installation.status,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: githubInstallations.installationId,
      set: {
        accountId: installation.accountId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositorySelection: installation.repositorySelection,
        status: installation.status,
        updatedAt: new Date(),
      },
    })
}

export async function handleGitHubInstallationWebhook({
  action,
  event,
  installationId,
}: {
  action: string
  event: GitHubInstallationWebhookEvent
  installationId: number
}) {
  const change = getGitHubInstallationChange(event, action)

  if (change.type === 'status') {
    await markGitHubInstallationStatus(installationId, change.status)
    return
  }

  if (change.type === 'refresh') {
    await upsertGitHubInstallation(await getAppInstallation(installationId))
  }
}

async function markGitHubInstallationStatus(
  installationId: number,
  status: 'active' | 'deleted' | 'suspended',
) {
  await db
    .update(githubInstallations)
    .set({ status, updatedAt: new Date() })
    .where(eq(githubInstallations.installationId, installationId))
}

function mapRepository(
  repo: GitHubRepositoryResponse,
  installationId: number,
): GitHubRepository {
  return {
    id: repo.id,
    installationId,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    private: repo.private,
    defaultBranch: repo.default_branch,
    updatedAt: repo.updated_at,
    permissions: {
      push: repo.permissions?.push ?? false,
    },
  }
}

function mapInstallation(
  installation: GitHubInstallationResponse,
): GitHubInstallation {
  return {
    id: installation.id,
    accountId: installation.account.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    status: installation.suspended_at ? 'suspended' : 'active',
  }
}

async function requestInstallationAccessToken({
  installationId,
  repositoryId,
}: {
  installationId: number
  repositoryId: number | null
}) {
  const jwt = await getGitHubAppJwt()
  const response = await fetch(
    `${githubApiBaseUrl}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders(jwt),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(repositoryId ? { repository_ids: [repositoryId] } : {}),
        permissions: {
          contents: 'read',
          metadata: 'read',
        },
      }),
    },
  )

  if (!response.ok) {
    throw new GitHubApiError(response.status, await readGitHubError(response))
  }

  const data = (await response.json()) as {
    token: string
    expires_at: string
  }

  return {
    token: data.token,
    expiresAt: data.expires_at,
    installationId,
  }
}

class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

function mapCommit(commit: GitHubCommitResponse) {
  return {
    sha: commit.sha,
    message: commit.commit?.message ?? null,
    authorName: commit.commit?.author?.name ?? null,
    authoredAt: commit.commit?.author?.date ?? null,
    url: commit.html_url ?? null,
  }
}

async function githubRequest<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${githubApiBaseUrl}${path}`, {
    headers: githubHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(await readGitHubError(response))
  }

  return response.json() as Promise<T>
}

function githubHeaders(accessToken: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'devpush',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function getGitHubAppJwt() {
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY) {
    throw new Error('GitHub App is not configured.')
  }

  const now = Math.floor(Date.now() / 1000)

  if (cachedJwt && cachedJwt.expiresAt - now > 60) {
    return cachedJwt.token
  }

  const privateKey = createPrivateKey(
    normalizePrivateKey(config.GITHUB_APP_PRIVATE_KEY),
  )
  const expiresAt = now + 10 * 60
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60)
    .setExpirationTime(expiresAt)
    .setIssuer(config.GITHUB_APP_ID)
    .sign(privateKey)

  cachedJwt = { token, expiresAt }

  return token
}

function normalizePrivateKey(value: string) {
  const trimmed = value.trim()
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed

  const withNewlines = unquoted.replace(/\\n/g, '\n')
  if (withNewlines.includes('\n')) {
    return withNewlines
  }

  const singleLinePem = withNewlines.match(
    /^-----BEGIN ([A-Z ]+)-----(.+)-----END \1-----$/,
  )
  if (!singleLinePem) {
    return withNewlines
  }

  const [, label, body] = singleLinePem
  const chunks = body.match(/.{1,64}/g) ?? []
  return [
    `-----BEGIN ${label}-----`,
    ...chunks,
    `-----END ${label}-----`,
    '',
  ].join('\n')
}

async function readGitHubError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }

    if (body.message) {
      return body.message
    }
  } catch {
    // Fall through to generic HTTP error.
  }

  return `GitHub request failed with ${response.status}`
}

function encodeURIComponentRepoName(fullName: string) {
  return fullName.split('/').map(encodeURIComponent).join('/')
}

function encodeURIComponentPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}
