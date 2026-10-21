import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createSmokeRpc } from './smoke-rpc.mjs'
import { makeSignature } from 'better-auth/crypto'
import { request as httpRequest } from 'node:http'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'

// Undici fetch sets sec-fetch-mode:cors even when callers try to model a
// navigation. Native HTTP preserves browser navigation metadata for this probe.
function browserNavigation(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        headers: {
          ...headers,
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: response.headers,
            }),
          ),
        )
      },
    )
    request.on('error', reject)
    request.end()
  })
}

// Receives the disposable store from smoke-worker. No live account, key or
// browser settings are touched, and generated credentials are never printed.
export async function smokeMcp({
  origin,
  query,
  authSecret,
  supportsCimd = false,
}) {
  const userId = randomUUID(),
    teamId = randomUUID(),
    memberId = randomUUID()
  const apiKeyId = randomUUID(),
    sessionId = randomUUID()
  const secret = `dp_${randomBytes(32).toString('hex')}`
  const sessionToken = randomBytes(32).toString('hex')
  const now = Date.now(),
    expiry = now + 3_600_000
  const scopes = JSON.stringify([
    'projects:read',
    'servers:read',
    'deployments:read',
    'backups:read',
  ])
  await query(
    0,
    `insert into user(id,name,username,email) values('${userId}','Worker MCP user','${userId}','${userId}@example.invalid')`,
  )
  await query(
    0,
    `insert into teams(id,name,slug) values('${teamId}','Worker MCP team','${teamId}')`,
  )
  await query(
    0,
    `insert into team_members(id,user_id,team_id,role) values('${memberId}','${userId}','${teamId}','admin')`,
  )
  await query(
    0,
    `insert into session(id,token,user_id,expires_at,created_at,updated_at) values('${sessionId}','${sessionToken}','${userId}',${expiry},${now},${now})`,
  )
  await query(
    0,
    `insert into api_keys(id,user_id,team_id,membership_id,name,prefix,key_hash,role_ceiling,preset,project_ids,scopes,expires_at,created_at) values('${apiKeyId}','${userId}','${teamId}','${memberId}','Worker MCP key','${secret.slice(0, 11)}','${createHash('sha256').update(secret).digest('hex')}','admin','read',null,'${scopes}',${expiry},${now})`,
  )
  const metadata = await fetch(
    `${origin}/.well-known/oauth-protected-resource/mcp`,
  )
  assert.equal(metadata.status, 200)
  assert.equal((await metadata.json()).resource, `${origin}/mcp`)
  const provider = await fetch(
    `${origin}/.well-known/oauth-authorization-server/api/auth`,
  )
  assert.equal(provider.status, 200)
  const providerMetadata = await provider.json()
  assert.equal(providerMetadata.issuer, `${origin}/api/auth`)
  assert.equal(
    providerMetadata.client_id_metadata_document_supported,
    supportsCimd ? true : undefined,
    'CIMD metadata must match the runtime transport capability',
  )
  const apiIdentity = await fetch(`${origin}/api/v1/identity`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  assert.equal(apiIdentity.status, 200)
  assert.equal((await apiIdentity.json()).user.id, userId)
  async function sdkConnection(token) {
    const client = new Client(
      { name: 'devpush-worker-smoke', version: '2.3.1' },
      { versionNegotiation: { mode: 'auto' } },
    )
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    )
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28')
    const tools = await client.listTools()
    assert(tools.tools.some((tool) => tool.name === 'list_projects'))
    assert(!tools.tools.some((tool) => tool.name === 'deploy'))
    const identity = await client.callTool({
      name: 'get_identity',
      arguments: {},
    })
    assert.notEqual(identity.isError, true)
    assert.equal(identity.structuredContent.user.id, userId)
    await client.close()
  }
  await sdkConnection(secret)
  const signature = await makeSignature(sessionToken, authSecret)
  const browserHeaders = {
    cookie: `devpush.session_token=${encodeURIComponent(sessionToken + '.' + signature)}`,
    origin,
    'content-type': 'application/json',
    accept: 'application/json',
  }
  const registered = await fetch(`${origin}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Worker MCP assistant',
      redirect_uris: ['http://127.0.0.1:9021/callback'],
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })
  assert(
    registered.status >= 200 && registered.status < 300,
    await registered.clone().text(),
  )
  const { client_id: clientId } = await registered.json()
  assert.match(clientId, /^[a-zA-Z0-9]+$/)
  const consentAction = await createSmokeRpc({
    origin,
    headers: browserHeaders,
    appDir: fileURLToPath(new URL('../', import.meta.url)),
    name: 'completeMcpConsentAction',
    modulePath: 'src/server/mcp/functions.ts',
    bundleDir: supportsCimd ? '.output/server/_ssr' : 'dist/server/assets',
  })
  async function authorizeConnection() {
    const before = new Set(
      (
        await query(0, `select id from api_grants where user_id='${userId}'`)
      ).map((row) => row.id),
    )
    const verifier = randomBytes(32).toString('base64url')
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:9022/callback',
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope: 'devpush:read offline_access',
      resource: `${origin}/mcp`,
      state: 'worker-mcp-state',
    })
    const authorization = await browserNavigation(
      `${origin}/api/auth/oauth2/authorize?${params}`,
      browserHeaders,
    )
    assert.equal(authorization.status, 302, await authorization.text())
    const consentUrl = new URL(authorization.headers.get('location'), origin)
    assert.equal(consentUrl.pathname, '/oauth/consent')
    const wrappedPage = await browserNavigation(consentUrl, browserHeaders)
    assert.equal(wrappedPage.status, 302)
    const wrappedUrl = new URL(wrappedPage.headers.get('location'), origin)
    assert.equal(wrappedUrl.origin, origin)
    assert.equal(wrappedUrl.searchParams.size, 1)
    assert.equal(
      wrappedUrl.searchParams.get('oauthQuery'),
      consentUrl.search.slice(1),
    )
    const consentPage = await browserNavigation(wrappedUrl, browserHeaders)
    const consentHtml = await consentPage.text()
    assert.equal(
      consentPage.status,
      200,
      consentPage.headers.get('location') ?? consentHtml.slice(0, 2000),
    )
    assert.match(
      consentHtml,
      /Connect app|Connect|Authoriz|data-slot="skeleton"/,
    )
    const consent = await consentAction({
      accepted: true,
      teamId,
      preset: 'read',
      includeLogs: false,
      oauthQuery: consentUrl.search.slice(1),
    })
    assert.ok(consent.result?.redirectUrl, JSON.stringify(consent.error))
    const callback = new URL(consent.result.redirectUrl, origin)
    const grants = await query(
      0,
      `select id from api_grants where user_id='${userId}'`,
    )
    const grantId = grants.find((row) => !before.has(row.id))?.id
    assert.ok(grantId, 'Browser consent creates its own grant')
    assert.equal(callback.searchParams.get('state'), 'worker-mcp-state')
    assert.equal(callback.searchParams.get('iss'), `${origin}/api/auth`)
    const exchange = await fetch(`${origin}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: 'http://127.0.0.1:9022/callback',
        resource: `${origin}/mcp`,
      }),
    })
    assert.equal(exchange.status, 200, await exchange.clone().text())
    const tokens = await exchange.json()
    assert.equal(tokens.token_type, 'Bearer')
    return { tokens, grantId }
  }
  const { tokens, grantId } = await authorizeConnection()
  await sdkConnection(tokens.access_token)
  await query(
    0,
    `update api_grants set revoked_at=${Date.now()} where id='${grantId}'`,
  )
  const denied = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  })
  assert.equal(denied.status, 401)
  const { tokens: replayTokens } = await authorizeConnection()
  const refreshInput = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: replayTokens.refresh_token,
    resource: `${origin}/mcp`,
  })
  const refreshRequest = () =>
    fetch(`${origin}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshInput,
    })
  const refreshed = await refreshRequest()
  assert.equal(refreshed.status, 200, await refreshed.clone().text())
  const rotated = await refreshed.json()
  await sdkConnection(rotated.access_token)
  const replay = await refreshRequest()
  assert(replay.status >= 400)
  const replayDenied = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${rotated.access_token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  })
  assert.equal(replayDenied.status, 401)
}
