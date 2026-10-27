import { beforeEach, expect, test, vi } from 'vitest'
import { withWorkspaceAccess } from './workspace-access'
import { WorkspacePolicyError } from '#devpush/plugins/server'

const state = vi.hoisted(() => ({ services: {} }))
vi.mock('./services.server', () => ({
  getPluginServices: () => state.services,
}))
beforeEach(() => {
  state.services = {}
})
test('an unextended application executes authorized mutations', async () => {
  const action = vi.fn(async () => 'created')
  expect(
    await withWorkspaceAccess('team', 'server.create', action, {
      kind: 'user',
      userId: 'owner',
    }),
  ).toBe('created')
  expect(action).toHaveBeenCalledOnce()
})
test('a private denial becomes a public error and never executes the core write', async () => {
  const action = vi.fn(async () => 'created')
  state.services = {
    workspaceAccess: {
      run: async () => {
        throw new WorkspacePolicyError('limit')
      },
    },
  }
  await expect(
    withWorkspaceAccess('team', 'server.create', action, {
      kind: 'user',
      userId: 'owner',
    }),
  ).rejects.toMatchObject({ code: 'WORKSPACE_LIMIT_REACHED' })
  expect(action).not.toHaveBeenCalled()
})
test('unrecognized extension failures cannot become user-facing messages', async () => {
  const error = {
    name: 'WorkspaceAccessError',
    code: 'PRIVATE_SECRET',
    message: 'secret',
  }
  state.services = {
    workspaceAccess: {
      run: async () => {
        throw error
      },
    },
  }
  await expect(
    withWorkspaceAccess('team', 'deployment.create', async () => null, {
      kind: 'user',
      userId: 'owner',
    }),
  ).rejects.toBe(error)
})

test('workspace policies receive the actor for server lifecycle changes', async () => {
  const run = vi.fn(async (_input, action) => action())
  state.services = { workspaceAccess: { run } }
  await withWorkspaceAccess('team', 'server.delete', async () => 'deleted', {
    kind: 'user',
    userId: 'owner',
  })
  expect(run).toHaveBeenCalledWith(
    {
      teamId: 'team',
      operation: 'server.delete',
      actor: { kind: 'user', userId: 'owner' },
    },
    expect.any(Function),
  )
})

test('admissions are scoped to the active callback, team and operation', async () => {
  const { requireWorkspaceAdmission } = await import('./workspace-access')
  let saved: Parameters<typeof requireWorkspaceAdmission>[0] | undefined
  await withWorkspaceAccess(
    'team',
    'deployment.create',
    async (admission) => {
      saved = admission
      expect(() =>
        requireWorkspaceAdmission(admission, 'team', 'deployment.create'),
      ).not.toThrow()
      expect(() =>
        requireWorkspaceAdmission(admission, 'other', 'deployment.create'),
      ).toThrow('Invalid workspace mutation admission')
      expect(() =>
        requireWorkspaceAdmission(admission, 'team', 'project.create'),
      ).toThrow('Invalid workspace mutation admission')
    },
    { kind: 'user', userId: 'owner' },
  )
  expect(() =>
    requireWorkspaceAdmission(saved!, 'team', 'deployment.create'),
  ).toThrow('Invalid workspace mutation admission')
  expect(() =>
    requireWorkspaceAdmission(
      { teamId: 'team', operation: 'deployment.create' } as typeof saved & {},
      'team',
      'deployment.create',
    ),
  ).toThrow('Invalid workspace mutation admission')
})
