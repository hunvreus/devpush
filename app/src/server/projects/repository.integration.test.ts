import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '@/server/db'
import {
  projects,
  teams,
  teamMembers,
  user,
  githubInstallations,
} from '@/server/db/schema'
import { createProjectFromGitHub } from './repository'

const github = vi.hoisted(() => ({ detect: vi.fn(), file: vi.fn() }))
vi.mock('@/server/github/service', () => ({
  getGitHubAccount: vi.fn().mockResolvedValue({ accessToken: 'fixture' }),
  listUserInstallations: vi.fn().mockResolvedValue([{ id: 42 }]),
  upsertGitHubInstallation: vi.fn(),
  getGitHubRepository: vi.fn().mockResolvedValue({
    id: 123,
    fullName: 'owner/repo',
    defaultBranch: 'main',
    permissions: { push: true },
  }),
  listInstallationRepositories: vi.fn().mockResolvedValue([{ id: 123 }]),
  detectComposePath: github.detect,
  getRepositoryFileText: github.file,
}))
let id = ''
afterEach(async () => {
  await db.delete(projects).where(eq(projects.teamId, id))
  await db.delete(teams).where(eq(teams.id, id))
  await db.delete(user).where(eq(user.id, id))
  await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.installationId, 42))
  vi.clearAllMocks()
})
afterAll(closeDb)

test.each([
  {
    requested: ' deploy/custom.yml ',
    expected: 'deploy/custom.yml',
    detects: 0,
  },
  { requested: undefined, expected: 'compose.yml', detects: 1 },
])(
  'project creation persists the selected Compose file: $expected',
  async ({ requested, expected, detects }) => {
    id = crypto.randomUUID()
    await db.insert(githubInstallations).values({
      installationId: 42,
      accountLogin: 'owner',
      accountType: 'User',
      repositorySelection: 'all',
    })
    await db
      .insert(user)
      .values({ id, name: 'Owner', username: id, email: `${id}@example.com` })
    await db.insert(teams).values({ id, name: 'Team', slug: id })
    await db
      .insert(teamMembers)
      .values({ id, userId: id, teamId: id, role: 'owner' })
    github.detect.mockResolvedValue('compose.yml')
    github.file.mockResolvedValue(
      'services:\n  selected-service:\n    image: example\n    expose: [8080]\n',
    )
    const created = await createProjectFromGitHub({
      userId: id,
      teamSlug: id,
      projectName: 'selected',
      repoFullName: 'owner/repo',
      installationId: 42,
      serverId: null,
      composePath: requested,
    })
    expect(created.composePath).toBe(expected)
    expect(github.detect).toHaveBeenCalledTimes(detects)
    expect(github.file).toHaveBeenCalledWith(
      expect.objectContaining({ path: expected }),
    )
    const saved = (
      await db.select().from(projects).where(eq(projects.id, created.id))
    )[0]!
    expect(saved.runtimeConfig).toMatchObject({ path: expected })
    expect(saved.composeMetadata).toMatchObject({
      services: ['selected-service'],
    })
  },
)
