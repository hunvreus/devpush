import { expect, test, vi } from 'vitest'
import { scopedPluginServices, withPluginScope } from './scope'

test('providers initialize lazily and are reused only within their invocation', async () => {
  const create = vi.fn(() => ({}))
  await withPluginScope(async () => {})
  expect(create).not.toHaveBeenCalled()
  const first = await withPluginScope(async () => {
    const services = scopedPluginServices(create)
    await Promise.resolve()
    expect(scopedPluginServices(create)).toBe(services)
    return services
  })
  const second = withPluginScope(() => scopedPluginServices(create))
  expect(second).not.toBe(first)
  expect(create).toHaveBeenCalledTimes(2)
})

test("concurrent and failed invocations cannot reuse each other's providers", async () => {
  const creates = [vi.fn(() => ({})), vi.fn(() => ({}))]
  const results = await Promise.all(
    creates.map((create) =>
      withPluginScope(async () => {
        const own = scopedPluginServices(create)
        await Promise.resolve()
        expect(scopedPluginServices(create)).toBe(own)
        return own
      }),
    ),
  )
  expect(results[0]).not.toBe(results[1])
  const flaky = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('configuration')
    })
    .mockReturnValue({})
  withPluginScope(() => {
    expect(() => scopedPluginServices(flaky)).toThrow('configuration')
    expect(scopedPluginServices(flaky)).toEqual({})
  })
  expect(flaky).toHaveBeenCalledTimes(2)
})
