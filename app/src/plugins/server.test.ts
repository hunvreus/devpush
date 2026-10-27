import { expect, test } from 'vitest'
import {
  composeServerPlugins,
  defineServerPlugin,
  WorkspacePolicyError,
} from './server'
import type { PluginContext, PluginServices } from './server'

const context: PluginContext = {
  hasServerRouting: async () => false,
  readServer: async () => null,
  listServers: async () => [],
}
const entry = (id: string, services: PluginServices) => ({
  id,
  implementation: defineServerPlugin(() => services),
})

test('policies wrap the mutation in configuration order and release afterward', async () => {
  const calls: string[] = []
  const policy = (id: string) =>
    entry(id, {
      workspaceAccess: {
        async run(_input, action) {
          calls.push(id + ':before')
          try {
            return await action()
          } finally {
            calls.push(id + ':after')
          }
        },
      },
    })
  const services = composeServerPlugins(
    [policy('first'), policy('second')],
    {},
    context,
  )
  expect(
    await services.workspaceAccess!.run(
      {
        actor: { kind: 'system', source: 'maintenance' },
        teamId: 'team',
        operation: 'server.create',
      },
      async () => {
        calls.push('write')
        return 42
      },
    ),
  ).toBe(42)
  expect(calls).toEqual([
    'first:before',
    'second:before',
    'write',
    'second:after',
    'first:after',
  ])
})

test('a rejected policy prevents subsequent policies and the mutation', async () => {
  let writes = 0
  const services = composeServerPlugins(
    [
      entry('limit', {
        workspaceAccess: {
          run: async () => {
            throw new Error('Restricted')
          },
        },
      }),
    ],
    {},
    context,
  )
  await expect(
    services.workspaceAccess!.run(
      {
        actor: { kind: 'system', source: 'maintenance' },
        teamId: 'team',
        operation: 'server.create',
      },
      async () => ++writes,
    ),
  ).rejects.toThrow('Restricted')
  expect(writes).toBe(0)
})

test('a faulty policy cannot execute the mutation twice', async () => {
  let writes = 0
  const services = composeServerPlugins(
    [
      entry('repeat', {
        workspaceAccess: {
          async run(_input, action) {
            await action()
            return action()
          },
        },
      }),
    ],
    {},
    context,
  )
  await expect(
    services.workspaceAccess!.run(
      {
        actor: { kind: 'system', source: 'maintenance' },
        teamId: 'team',
        operation: 'server.create',
      },
      async () => ++writes,
    ),
  ).rejects.toThrow('more than once')
  expect(writes).toBe(1)
})

test('exclusive providers conflict before their handlers run', () => {
  const provider = async () => ({ hostname: 'example.test', https: true })
  expect(() =>
    composeServerPlugins(
      [
        entry('one', { generateHostname: provider }),
        entry('two', { generateHostname: provider }),
      ],
      {},
      context,
    ),
  ).toThrow('Conflicting generateHostname providers: one, two')
})

test('plugin HTTP dispatch is isolated by namespace and keeps the authenticated identity', async () => {
  const services = composeServerPlugins(
    [
      entry('one', {
        handleRequest: async (_request, session) => Response.json(session),
      }),
      entry('two', { handleRequest: async () => new Response('two') }),
    ],
    {},
    context,
  )
  const session = { userId: 'user', email: 'test@example.test' }
  expect(
    await (
      await services.handleRequest!(
        new Request('https://hub.test/api/plugins/one/settings'),
        session,
      )
    ).json(),
  ).toEqual(session)
  expect(
    await (
      await services.handleRequest!(
        new Request('https://hub.test/api/plugins/two'),
        session,
      )
    ).text(),
  ).toBe('two')
  expect(
    (
      await services.handleRequest!(
        new Request('https://hub.test/api/plugins/other'),
        session,
      )
    ).status,
  ).toBe(404)
})

test('runtime log policies are optional and have one authoritative provider', () => {
  const limits = { bytesPerMinute: 100, bytesPerDay: 1000, rowsPerDay: 100 }
  expect(composeServerPlugins([], {}, context).runtimeLogLimits).toBeUndefined()
  expect(
    composeServerPlugins(
      [entry('logs', { runtimeLogLimits: () => limits })],
      {},
      context,
    ).runtimeLogLimits?.('team'),
  ).toEqual(limits)
  expect(() =>
    composeServerPlugins(
      [
        entry('one', { runtimeLogLimits: () => limits }),
        entry('two', { runtimeLogLimits: () => limits }),
      ],
      {},
      context,
    ),
  ).toThrow('Conflicting runtimeLogLimits')
})

test('a policy cannot retain its callback and execute a mutation after returning', async () => {
  let saved!: () => Promise<unknown>
  let writes = 0
  const services = composeServerPlugins(
    [
      entry('late', {
        workspaceAccess: {
          run: async (_input, next) => {
            saved = next
            return undefined as never
          },
        },
      }),
    ],
    {},
    context,
  )
  await expect(
    services.workspaceAccess!.run(
      {
        teamId: 'team',
        operation: 'server.create',
        actor: { kind: 'system', source: 'maintenance' },
      },
      async () => ++writes,
    ),
  ).rejects.toThrow('did not invoke')
  expect(() => saved()).toThrow('after returning')
  expect(writes).toBe(0)
})
test('policy completion cannot outrun the mutation or replace its result', async () => {
  let release!: () => void
  const services = composeServerPlugins(
    [
      entry('unawaited', {
        workspaceAccess: {
          run: async (_input, next) => {
            void next()
            return 'forged' as never
          },
        },
      }),
    ],
    {},
    context,
  )
  let finished = false
  const pending = services
    .workspaceAccess!.run(
      {
        teamId: 'team',
        operation: 'server.create',
        actor: { kind: 'system', source: 'maintenance' },
      },
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return 'actual'
      },
    )
    .then((value) => {
      finished = true
      return value
    })
  await Promise.resolve()
  expect(finished).toBe(false)
  release()
  expect(await pending).toBe('actual')
})
test('plugin environment and actor snapshots cannot mutate the callers configuration', async () => {
  const environment = { EXAMPLE: 'original' }
  const actor = { kind: 'user' as const, userId: 'owner' }
  const services = composeServerPlugins(
    [
      {
        id: 'immutable',
        implementation: defineServerPlugin((env) => {
          expect(Object.isFrozen(env)).toBe(true)
          expect(() => Object.assign(env, { EXAMPLE: 'changed' })).toThrow()
          return {
            workspaceAccess: {
              run: async (input, next) => {
                expect(Object.isFrozen(input.actor)).toBe(true)
                expect(() =>
                  Object.assign(input.actor, { userId: 'other' }),
                ).toThrow()
                return next()
              },
            },
          }
        }),
      },
    ],
    environment,
    context,
  )
  await services.workspaceAccess!.run(
    { teamId: 'team', operation: 'server.create', actor },
    async () => null,
  )
  expect(environment.EXAMPLE).toBe('original')
  expect(actor.userId).toBe('owner')
})

test('one failing maintenance provider does not prevent other providers running', async () => {
  let secondRan = false
  const services = composeServerPlugins(
    [
      entry('first', {
        serverLifecycle: {
          reconcile: async () => {},
          maintain: async () => {
            throw new Error('unavailable')
          },
        },
      }),
      entry('second', {
        serverLifecycle: {
          reconcile: async () => {},
          maintain: async () => {
            secondRan = true
          },
        },
      }),
    ],
    {},
    context,
  )
  await expect(services.serverLifecycle!.maintain()).rejects.toThrow(
    'Plugin maintenance failed',
  )
  expect(secondRan).toBe(true)
})

test('a refusal after a completed write is not reported as a pre-write policy rejection', async () => {
  let writes = 0
  const services = composeServerPlugins(
    [
      entry('late-refusal', {
        workspaceAccess: {
          run: async (_input, next) => {
            await next()
            throw new WorkspacePolicyError('restricted')
          },
        },
      }),
    ],
    {},
    context,
  )
  const pending = services.workspaceAccess!.run(
    {
      teamId: 'team',
      operation: 'server.create',
      actor: { kind: 'system', source: 'maintenance' },
    },
    async () => ++writes,
  )
  await expect(pending).rejects.toThrow('already completed mutation')
  await expect(pending).rejects.not.toBeInstanceOf(WorkspacePolicyError)
  expect(writes).toBe(1)
})
