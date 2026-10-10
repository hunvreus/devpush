import { expect, test } from 'vitest'
import { remoteDatabaseConfig } from './remote-config'

test('selects local by default and requires separate complete remote settings', () => {
  expect(remoteDatabaseConfig({})).toBeUndefined()
  expect(() =>
    remoteDatabaseConfig({ DEVPUSH_DATABASE_AUTH_TOKEN: 'secret' }),
  ).toThrow('require remote')
  expect(() =>
    remoteDatabaseConfig({ DEVPUSH_DATABASE_URL: 'libsql://main.example' }),
  ).toThrow('both')
  expect(() =>
    remoteDatabaseConfig({
      DEVPUSH_DATABASE_URL: 'libsql://main.example',
      DEVPUSH_LOG_DATABASE_URL: 'https://main.example/',
    }),
  ).toThrow('different')
  expect(() =>
    remoteDatabaseConfig({
      DEVPUSH_DATABASE_URL: 'file:main.db',
      DEVPUSH_LOG_DATABASE_URL: 'file:logs.db',
    }),
  ).toThrow('URLs')
  expect(
    remoteDatabaseConfig({
      DEVPUSH_DATABASE_URL: 'libsql://main.example',
      DEVPUSH_LOG_DATABASE_URL: 'libsql://logs.example',
      DEVPUSH_DATABASE_AUTH_TOKEN: 'secret',
    }),
  ).toEqual({
    main: { url: 'libsql://main.example', authToken: 'secret' },
    logs: { url: 'libsql://logs.example', authToken: undefined },
  })
})
