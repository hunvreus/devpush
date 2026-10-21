export function createMcpUrls(config: {
  DEVPUSH_MCP_URL: string
  DEVPUSH_BASE_URL: string
  BETTER_AUTH_URL: string
}) {
  return {
    resource: config.DEVPUSH_MCP_URL,
    metadata: new URL(
      '/.well-known/oauth-protected-resource/mcp',
      config.DEVPUSH_MCP_URL,
    ).toString(),
    origins: new Set(
      [
        config.DEVPUSH_MCP_URL,
        config.DEVPUSH_BASE_URL,
        config.BETTER_AUTH_URL,
      ].map((url) => new URL(url).origin),
    ),
  }
}
