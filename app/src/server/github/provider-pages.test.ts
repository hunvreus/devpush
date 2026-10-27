import { afterEach, expect, test, vi } from 'vitest'
import {
  listInstallationRepositoriesPage,
  listRepositoryBranchesPage,
  listUserInstallationsPage,
} from './service'

vi.mock('#devpush/server/db', () => ({ db: {} }))
vi.mock('#devpush/server/config', () => ({ config: {} }))
afterEach(() => vi.unstubAllGlobals())

test('installation discovery fetches only the requested provider page', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      total_count: 51,
      installations: [
        {
          id: 11,
          account: { id: 12, login: 'owner', type: 'Organization' },
          repository_selection: 'selected',
        },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const page = await listUserInstallationsPage({
    accessToken: 'private-token',
    page: 2,
    perPage: 25,
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[0]).toBe(
    'https://api.github.com/user/installations?per_page=25&page=2',
  )
  expect(page).toEqual({
    items: [
      {
        id: 11,
        accountLogin: 'owner',
        accountType: 'Organization',
        repositorySelection: 'selected',
      },
    ],
    hasMore: true,
  })
  expect(JSON.stringify(page)).not.toContain('private-token')
})

test('repository discovery retains provider continuation without collecting other pages', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      total_count: 200,
      repositories: [
        {
          id: 1,
          name: 'repo',
          full_name: 'owner/repo',
          private: true,
          default_branch: 'main',
          updated_at: '2026-10-13T00:00:00Z',
          owner: { login: 'owner' },
          permissions: { push: true },
        },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const page = await listInstallationRepositoriesPage({
    accessToken: 'private-token',
    installationId: 7,
    page: 3,
    perPage: 25,
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[0]).toBe(
    'https://api.github.com/user/installations/7/repositories?per_page=25&page=3',
  )
  expect(page.hasMore).toBe(true)
  expect(page.items[0]).toMatchObject({
    id: 1,
    fullName: 'owner/repo',
    permissions: { push: true },
  })
})

test('branch discovery exposes a continuation instead of dropping later matching branches', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json([{ name: 'main' }, { name: 'feature/a' }]),
    )
    .mockResolvedValueOnce(Response.json([{ name: 'feature/b' }]))
  vi.stubGlobal('fetch', fetch)
  expect(
    await listRepositoryBranchesPage({
      accessToken: 'private-token',
      repo: 'owner/repo',
      page: 1,
      perPage: 2,
    }),
  ).toEqual({ items: ['main', 'feature/a'], hasMore: true })
  expect(
    await listRepositoryBranchesPage({
      accessToken: 'private-token',
      repo: 'owner/repo',
      page: 2,
      perPage: 2,
    }),
  ).toEqual({ items: ['feature/b'], hasMore: false })
  expect(fetch).toHaveBeenCalledTimes(2)
})
