import { beforeEach, expect, test, vi } from 'vitest'
import { getManualDeploymentOptions } from './deployments'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  token: vi.fn(),
  branches: vi.fn(),
  commits: vi.fn(),
}))
vi.mock('./context', () => ({ getProjectContext: mocks.context }))
vi.mock('@/server/github/service', () => ({
  createInstallationAccessToken: mocks.token,
  listRepositoryBranches: mocks.branches,
  listBranchCommits: mocks.commits,
  getBranchHeadCommit: vi.fn(),
}))
const params = {
  environmentId: 'preview',
  userId: 'u',
  teamSlug: 'team',
  projectName: 'project',
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({
    project: {
      githubInstallationId: 1,
      githubRepoId: 2,
      githubRepo: 'owner/repo',
    },
    environments: [
      { id: 'production', branch: 'main', isProduction: true },
      { id: 'preview', branch: 'feature/*' },
    ],
  })
  mocks.token.mockResolvedValue({ token: 'test-token' })
  mocks.branches.mockResolvedValue(['main', 'feature/a', 'feature/b', 'other'])
  mocks.commits.mockResolvedValue([{ sha: 'abc', message: 'Commit' }])
})
test('opening a wildcard environment loads only its first branch while exposing every matching branch', async () => {
  const result = await getManualDeploymentOptions(params)
  expect(result.branches).toEqual(['feature/a', 'feature/b'])
  expect(result.selectedBranch).toBe('feature/a')
  expect(result.commits[0]?.branch).toBe('feature/a')
  expect(mocks.commits).toHaveBeenCalledTimes(1)
  expect(mocks.commits).toHaveBeenCalledWith(
    expect.objectContaining({ branch: 'feature/a', perPage: 5 }),
  )
  expect(mocks.context).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'u', scope: 'shell' }),
  )
})
test('choosing another branch fetches only that branch', async () => {
  const result = await getManualDeploymentOptions({
    ...params,
    branch: 'feature/b',
  })
  expect(result.selectedBranch).toBe('feature/b')
  expect(mocks.commits).toHaveBeenCalledTimes(1)
  expect(mocks.commits).toHaveBeenCalledWith(
    expect.objectContaining({ branch: 'feature/b' }),
  )
})
test.each(['main', 'other', 'missing'])(
  'rejects branches outside the selected environment: %s',
  async (branch) => {
    await expect(
      getManualDeploymentOptions({ ...params, branch }),
    ).rejects.toMatchObject({ code: 'DEPLOYMENT_BRANCH_MISMATCH' })
    expect(mocks.commits).not.toHaveBeenCalled()
  },
)
test('an environment with no matching branches makes no commit requests', async () => {
  mocks.branches.mockResolvedValue(['main'])
  await expect(getManualDeploymentOptions(params)).resolves.toMatchObject({
    branches: [],
    selectedBranch: null,
    commits: [],
  })
  expect(mocks.commits).not.toHaveBeenCalled()
})
test('permission failures stop all GitHub requests', async () => {
  mocks.context.mockRejectedValue(new Error('Forbidden'))
  await expect(getManualDeploymentOptions(params)).rejects.toThrow('Forbidden')
  expect(mocks.token).not.toHaveBeenCalled()
  expect(mocks.branches).not.toHaveBeenCalled()
})
