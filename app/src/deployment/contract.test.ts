import { describe, expect, test } from 'vitest'
import {
  defineServerDeployment,
  deploymentApiVersion,
  validateDeploymentServices,
} from './contract'

describe('deployment contract', () => {
  test('rejects incompatible versions and unsupported services instead of using OSS defaults', () => {
    expect(() =>
      defineServerDeployment({
        apiVersion: deploymentApiVersion + 1,
        name: 'test',
        create: () => ({}),
      }),
    ).toThrow(/Incompatible/)
    expect(() =>
      validateDeploymentServices({ generateHostname: 'invalid' }),
    ).toThrow(/hostname/)
    expect(() =>
      validateDeploymentServices({ arbitraryHook: () => {} }),
    ).toThrow(/Unknown/)
    expect(() =>
      validateDeploymentServices({
        serverLifecycle: { reconcile() {} },
      }),
    ).toThrow(/lifecycle/)
    expect(() => validateDeploymentServices({ certificates: {} })).toThrow(
      /certificate/,
    )
  })

  test('validates concrete workspace and HTTP services', () => {
    expect(() =>
      validateDeploymentServices({ workspaceAccess: { run() {} } }),
    ).toThrow(/workspace access/)
    expect(() => validateDeploymentServices({ handleRequest: true })).toThrow(
      /request/,
    )
    expect(() =>
      validateDeploymentServices({
        workspaceAccess: {
          run: async (_input: unknown, action: () => Promise<unknown>) =>
            action(),
          connected: async () => {},
        },
        handleRequest: async () => new Response(),
      }),
    ).not.toThrow()
  })

  test('accepts explicit optional services and freezes the contract', () => {
    const services = validateDeploymentServices({
      certificates: {
        request: async () => ({ status: 'pending', retryAfter: 10 }),
      },
    })
    const deployment = defineServerDeployment({
      apiVersion: deploymentApiVersion,
      name: 'test',
      create: () => services,
    })
    expect(Object.isFrozen(services)).toBe(true)
    expect(Object.isFrozen(deployment)).toBe(true)
  })
})
