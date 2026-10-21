import { beforeEach, expect, test, vi } from 'vitest'
import { withWorkspaceAccess } from './workspace-access'

const state = vi.hoisted(() => ({ services: {} }))
vi.mock('./services.server', () => ({
  getDeploymentServices: () => state.services,
}))
beforeEach(() => {
  state.services = {}
})
test('OSS executes mutations without commercial restrictions', async () => {
  const action = vi.fn(async () => 'created')
  expect(await withWorkspaceAccess('team', 'server.create', action)).toBe(
    'created',
  )
  expect(action).toHaveBeenCalledOnce()
})
test('a private denial becomes a public error and never executes the core write', async () => {
  const action = vi.fn(async () => 'created')
  state.services = {
    workspaceAccess: {
      run: async () => {
        throw {
          name: 'WorkspaceAccessError',
          code: 'PLAN_LIMIT_REACHED',
          message: 'private provider details',
        }
      },
    },
  }
  await expect(
    withWorkspaceAccess('team', 'server.create', action),
  ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' })
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
    withWorkspaceAccess('team', 'deployment.create', async () => null),
  ).rejects.toBe(error)
})
