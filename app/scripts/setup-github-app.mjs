#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

main().catch((error) => {
  console.error(`\nSetup failed: ${toMessage(error)}`)
  process.exit(1)
})

async function main() {
  const host = '127.0.0.1'
  const port = Number(args.port || 8787)
  const baseUrl = trimSlash(
    args.baseUrl || process.env.BETTER_AUTH_URL || 'http://localhost:7429',
  )
  const ownerType = args.ownerType === 'org' ? 'org' : 'personal'
  const org = ownerType === 'org' ? args.org.trim() : ''

  if (ownerType === 'org' && !org) {
    throw new Error('Missing --org <slug> when --owner-type org.')
  }

  const state = randomBytes(16).toString('hex')
  const webhookSecret = randomBytes(32).toString('base64url')
  const callbackUrl = `http://${host}:${port}/callback`
  const manifest = {
    name:
      args.appName.trim() ||
      `devpush ${new URL(baseUrl).hostname} ${randomBytes(2).toString('hex')}`,
    url: baseUrl,
    callback_urls: [`${baseUrl}/api/auth/callback/github`],
    redirect_url: callbackUrl,
    description: 'Deploy GitHub repositories to your own servers with devpush.',
    public: false,
    default_permissions: { contents: 'read', metadata: 'read' },
    default_events: ['push', 'installation_target'],
    request_oauth_on_install: false,
    setup_on_update: true,
    setup_url: `${baseUrl}/api/github/install/callback`,
    hook_attributes: {
      active: true,
      secret: webhookSecret,
      url: `${baseUrl}/api/github/webhook`,
    },
  }
  const creationUrl =
    ownerType === 'org'
      ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}`
      : `https://github.com/settings/apps/new?state=${state}`
  const code = await waitForManifestCode({
    callbackUrl,
    creationUrl,
    host,
    manifest,
    open: args.open,
    port,
    state,
  })
  const app = await exchangeManifestCode(code)
  const values = {
    GITHUB_APP_CLIENT_ID: app.client_id,
    GITHUB_APP_CLIENT_SECRET: app.client_secret,
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_NAME: app.slug,
    GITHUB_APP_PRIVATE_KEY: quote(app.pem || ''),
    GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
  }

  if (args.envPath) {
    const envPath = resolve(process.cwd(), args.envPath)
    upsertEnv(envPath, values)
    console.log(`\nGitHub App created and ${envPath} updated.`)
  } else {
    console.log('\nGitHub App created. Add these values to your environment:')
    for (const [key, value] of Object.entries(values)) {
      console.log(`${key}=${value}`)
    }
  }

  console.log(
    `\nInstall it from https://github.com/apps/${app.slug}/installations/new`,
  )
}

async function waitForManifestCode({
  callbackUrl,
  creationUrl,
  host,
  manifest,
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
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', callbackUrl)

    if (url.pathname === '/start') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(autoPostPage(creationUrl, manifest))
      return
    }

    if (url.pathname !== '/callback') {
      response.writeHead(404).end('Not found')
      return
    }

    const code = url.searchParams.get('code') || ''
    if (url.searchParams.get('state') !== state || !code) {
      response.writeHead(400).end('Invalid callback. Return to the terminal.')
      rejectCode(new Error('GitHub App creation callback was invalid.'))
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

  const startUrl = `http://${host}:${port}/start`
  console.log(`\nApprove the GitHub App in your browser:\n${startUrl}`)
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
  }
}

async function exchangeManifestCode(code) {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
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

function upsertEnv(filePath, values) {
  const lines = existsSync(filePath)
    ? readFileSync(filePath, 'utf8').split(/\r?\n/)
    : []

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`
    const index = lines.findIndex((current) => current.startsWith(`${key}=`))
    if (index >= 0) lines[index] = line
    else lines.push(line)
  }

  writeFileSync(filePath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8')
}

function openBrowser(url) {
  if (process.platform === 'darwin') execFile('open', [url], () => {})
  else if (process.platform === 'win32')
    execFile('cmd', ['/c', 'start', '', url], () => {})
  else execFile('xdg-open', [url], () => {})
}

function parseArgs(argv) {
  const result = {
    appName: '',
    baseUrl: '',
    envPath: '',
    help: false,
    open: true,
    org: '',
    ownerType: '',
    port: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '-h' || value === '--help') result.help = true
    else if (value === '--no-open') result.open = false
    else if (value === '--app-name') result.appName = argv[++index] || ''
    else if (value === '--base-url') result.baseUrl = argv[++index] || ''
    else if (value === '--env') result.envPath = argv[++index] || ''
    else if (value === '--org') result.org = argv[++index] || ''
    else if (value === '--owner-type') result.ownerType = argv[++index] || ''
    else if (value === '--port') result.port = argv[++index] || ''
    else throw new Error(`Unknown option: ${value}`)
  }

  return result
}

function printHelp() {
  console.log(`GitHub App setup helper

Usage: pnpm setup:github-app [options]

  --base-url <url>       devpush URL (default: http://localhost:7429)
  --app-name <name>      GitHub App name (default: unique generated name)
  --owner-type <type>    personal or org (default: personal)
  --org <slug>           Organization slug for an org-owned app
  --env <path>           Update an env file with generated credentials
  --port <number>        Local callback port (default: 8787)
  --no-open              Do not open the browser automatically`)
}

function quote(value) {
  return `"${value.replace(/\r\n/g, '\n').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
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
