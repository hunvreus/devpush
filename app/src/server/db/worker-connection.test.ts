import { sql } from 'drizzle-orm'
import { createClient as createLocalClient } from '@libsql/client'
import { afterEach, expect, test, vi } from 'vitest'
import { createClient } from '@libsql/client/web'
import { openWorkerDatabases, createWorkerDatabases } from './worker-connection'

vi.mock('@libsql/client/web', () => ({ createClient: vi.fn() }))
afterEach(() => vi.resetAllMocks())

test('rejects absent or partial storage configuration before querying', () => {
  expect(() => openWorkerDatabases({})).toThrow('both D1 bindings')
  expect(() =>
    openWorkerDatabases({ DEVPUSH_DATABASE_URL: 'https://main.example' }),
  ).toThrow('both DEVPUSH_DATABASE_URL')
})

test('remote URLs need no D1 bindings and route each store to its own client', async () => {
  const clients: ReturnType<typeof createLocalClient>[] = []
  vi.mocked(createClient).mockImplementation(() => {
    const client = createLocalClient({ url: ':memory:' })
    clients.push(client)
    return client
  })
  const stores = openWorkerDatabases({
    DEVPUSH_DATABASE_URL: 'libsql://main.example',
    DEVPUSH_LOG_DATABASE_URL: 'libsql://logs.example',
    DEVPUSH_DATABASE_AUTH_TOKEN: 'main-token',
    DEVPUSH_LOG_DATABASE_AUTH_TOKEN: 'logs-token',
  })
  expect(createClient).not.toHaveBeenCalled()
  await Promise.all([
    stores.db.all(sql`select 1`),
    stores.logsDb.all(sql`select 2`),
  ])
  expect(createClient).toHaveBeenCalledWith({
    url: 'libsql://main.example',
    authToken: 'main-token',
  })
  expect(createClient).toHaveBeenCalledWith({
    url: 'libsql://logs.example',
    authToken: 'logs-token',
  })
  expect(clients.every((client) => client.closed)).toBe(true)
})

test('module initialization defers binding resolution until a database is used', async () => {
  vi.mocked(createClient).mockImplementation(() =>
    createLocalClient({ url: ':memory:' }),
  )
  const env: Parameters<typeof createWorkerDatabases>[0] = {}
  const stores = createWorkerDatabases(env)
  expect(createClient).not.toHaveBeenCalled()
  expect(() => stores.db.select()).toThrow('both D1 bindings')
  Object.assign(env, {
    DEVPUSH_DATABASE_URL: 'https://main.example',
    DEVPUSH_LOG_DATABASE_URL: 'https://logs.example',
  })
  expect(await stores.db.all(sql`select 1`)).toEqual([[1]])
  expect(await stores.logsDb.all(sql`select 2`)).toEqual([[2]])
})
