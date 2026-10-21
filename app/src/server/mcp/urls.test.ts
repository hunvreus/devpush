import { expect, test } from 'vitest'
import { parseConfig } from '@/server/config'
import { createMcpUrls } from './urls'

test('advertises the explicit localhost endpoint while preserving the Lima agent base', () => {
  const config = parseConfig({
    DEVPUSH_BASE_URL: 'http://host.lima.internal:7429',
    BETTER_AUTH_URL: 'http://localhost:7429',
    DEVPUSH_MCP_URL: 'http://localhost:7429/mcp',
  })
  const urls = createMcpUrls(config)
  expect(urls.resource).toBe('http://localhost:7429/mcp')
  expect(urls.metadata).toBe(
    'http://localhost:7429/.well-known/oauth-protected-resource/mcp',
  )
  expect([...urls.origins]).toEqual([
    'http://localhost:7429',
    'http://host.lima.internal:7429',
  ])
  expect(config.BETTER_AUTH_URL).toBe('http://localhost:7429')
})

test('includes a separate public MCP origin without changing the authentication issuer', () => {
  const config = parseConfig({
    DEVPUSH_BASE_URL: 'https://app.devpush.example',
    DEVPUSH_MCP_URL: 'https://mcp.devpush.example/mcp',
  })
  const urls = createMcpUrls(config)
  expect(urls.metadata).toBe(
    'https://mcp.devpush.example/.well-known/oauth-protected-resource/mcp',
  )
  expect(urls.origins.has('https://mcp.devpush.example')).toBe(true)
  expect(urls.origins.has('https://app.devpush.example')).toBe(true)
  expect(urls.origins.has('https://other.example')).toBe(false)
  expect(config.BETTER_AUTH_URL).toBe('https://app.devpush.example')
})
