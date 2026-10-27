import { expect, test } from 'vitest'
import { validatePluginServices } from './contract'
import { composeServerPlugins, defineServerPlugin } from './server'

test('unsupported services and incomplete providers fail closed', () => {
  expect(() => validatePluginServices({ arbitraryHook: () => {} })).toThrow(
    /Unknown/,
  )
  expect(() => validatePluginServices({ generateHostname: 'invalid' })).toThrow(
    /hostname/,
  )
  expect(() =>
    validatePluginServices({ serverLifecycle: { reconcile() {} } }),
  ).toThrow(/lifecycle/)
  expect(() => validatePluginServices({ certificates: {} })).toThrow(
    /certificate/,
  )
  expect(() =>
    validatePluginServices({ workspaceAccess: { connected() {} } }),
  ).toThrow(/workspace access/)
  expect(() => validatePluginServices({ handleRequest: true })).toThrow(
    /request/,
  )
})
test('incompatible implementations fail instead of falling back to defaults', () => {
  expect(() =>
    composeServerPlugins(
      [
        {
          id: 'example',
          implementation: { apiVersion: 2 as 3, create: () => ({}) },
        },
      ],
      {},
      {
        hasServerRouting: async () => false,
        readServer: async () => null,
        listServers: async () => [],
      },
    ),
  ).toThrow(/Incompatible/)
})
test('service and implementation declarations are immutable', () => {
  const service = validatePluginServices({
    certificates: {
      request: async () => ({ status: 'pending', retryAfter: 10 }),
    },
  })
  expect(Object.isFrozen(service)).toBe(true)
  expect(Object.isFrozen(defineServerPlugin(() => service))).toBe(true)
})
