import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

export async function createGitHubApp({
  appName = '',
  authUrl,
  baseUrl,
  exchange = exchangeManifestCode,
  onAuthorize = console.log,
  open = true,
  org = '',
  ownerType = 'personal',
  persist = async () => {},
  port = 0,
}) {
  const host = '127.0.0.1'
  const normalizedBaseUrl = trimSlash(baseUrl)
  const normalizedAuthUrl = trimSlash(authUrl || normalizedBaseUrl)
  const state = randomBytes(16).toString('hex')
  const webhookSecret = randomBytes(32).toString('base64url')
  const manifest = {
    name:
      appName.trim() ||
      `devpush ${new URL(normalizedBaseUrl).hostname} ${randomBytes(2).toString('hex')}`,
    url: normalizedBaseUrl,
    callback_urls: [`${normalizedAuthUrl}/api/auth/callback/github`],
    description: 'Deploy GitHub repositories to your own servers with devpush.',
    public: false,
    default_permissions: { contents: 'read', metadata: 'read' },
    default_events: ['push', 'installation_target'],
    request_oauth_on_install: false,
    setup_on_update: true,
    setup_url: `${normalizedBaseUrl}/api/github/install/callback`,
    hook_attributes: {
      active: true,
      secret: webhookSecret,
      url: `${normalizedBaseUrl}/api/github/webhook`,
    },
  }
  const creationUrl =
    ownerType === 'org'
      ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}`
      : `https://github.com/settings/apps/new?state=${state}`
  const code = await waitForManifestCode({
    creationUrl,
    host,
    manifest,
    onAuthorize,
    open,
    port,
    state,
  })
  let app
  try {
    app = await exchange(code)
  } catch (error) {
    throw new Error(
      `GitHub created the App but its credentials could not be saved. Check your GitHub App settings before running setup again to avoid creating a duplicate. ${toMessage(error)}`,
      { cause: error },
    )
  }
  if (!app.client_secret || !app.pem) {
    throw new Error('GitHub did not return the App credentials.')
  }

  const values = {
    GITHUB_APP_CLIENT_ID: app.client_id,
    GITHUB_APP_CLIENT_SECRET: app.client_secret,
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_NAME: app.slug,
    GITHUB_APP_PRIVATE_KEY: app.pem,
    GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
  }
  await persist(values)

  return {
    installUrl: `https://github.com/apps/${app.slug}/installations/new`,
    values,
  }
}

async function waitForManifestCode({
  creationUrl,
  host,
  manifest,
  onAuthorize,
  open,
  port,
  state,
}) {
  let resolveCode
  let rejectCode
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  let callbackUrl = ''
  let expectedHost = ''
  const startToken = randomBytes(32).toString('hex')
  const server = createServer((request, response) => {
    if (request.headers.host !== expectedHost) {
      response.writeHead(400).end('Invalid host.')
      return
    }
    const url = new URL(request.url || '/', callbackUrl)

    if (url.pathname === '/start') {
      if (!matchesSecret(url.searchParams.get('token') || '', startToken)) {
        response.writeHead(404).end('Not found')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(
        autoPostPage(creationUrl, { ...manifest, redirect_url: callbackUrl }),
      )
      return
    }

    if (url.pathname !== '/callback') {
      response.writeHead(404).end('Not found')
      return
    }

    const code = url.searchParams.get('code') || ''
    if (url.searchParams.get('state') !== state || !code) {
      response.writeHead(400).end('Invalid callback. Return to the terminal.')
      return
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<h1>GitHub App created.</h1><p>Return to the terminal.</p>')
    resolveCode(code)
  })

  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolveListen)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not determine the GitHub callback port.')
  }
  expectedHost = `${host}:${address.port}`
  callbackUrl = `http://${expectedHost}/callback`
  const startUrl = `http://${expectedHost}/start?token=${startToken}`
  onAuthorize(startUrl)
  if (open) openBrowser(startUrl)

  const timeout = setTimeout(
    () => rejectCode(new Error('Timed out waiting for GitHub.')),
    10 * 60 * 1000,
  )
  try {
    return await codePromise
  } finally {
    clearTimeout(timeout)
    server.close()
    server.closeAllConnections()
  }
}

function matchesSecret(value, expected) {
  const actualBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

async function exchangeManifestCode(code) {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'devpush-setup',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      `GitHub manifest conversion failed (${response.status}): ${await response.text()}`,
    )
  }

  return response.json()
}

function autoPostPage(action, manifest) {
  return `<!doctype html><html><body><form id="form" method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button type="submit">Continue to GitHub</button></form><script>document.getElementById('form').submit()</script></body></html>`
}

function openBrowser(url) {
  if (process.platform === 'darwin') execFile('open', [url], () => {})
  else if (process.platform === 'win32')
    execFile('cmd', ['/c', 'start', '', url], () => {})
  else execFile('xdg-open', [url], () => {})
}

function trimSlash(value) {
  return value.replace(/\/+$/g, '')
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
