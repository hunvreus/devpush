#!/usr/bin/env node
import { resolve } from 'node:path'
import { upsertEnv } from '../../scripts/setup-config.mjs'
import { createGitHubApp } from './github-app.mjs'

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
  const port = Number(args.port || 8787)
  const baseUrl = trimSlash(
    args.baseUrl || process.env.DEVPUSH_BASE_URL || 'http://localhost:7429',
  )
  const authUrl = trimSlash(
    args.baseUrl || process.env.BETTER_AUTH_URL || baseUrl,
  )
  const ownerType = args.ownerType === 'org' ? 'org' : 'personal'
  const org = ownerType === 'org' ? args.org.trim() : ''

  if (ownerType === 'org' && !org) {
    throw new Error('Missing --org <slug> when --owner-type org.')
  }

  const envPath = args.envPath
    ? resolve(process.cwd(), args.envPath)
    : resolve(process.cwd(), 'app/.env')
  const { installUrl } = await createGitHubApp({
    appName: args.appName,
    authUrl,
    baseUrl,
    onAuthorize: (url) =>
      console.log(`\nApprove the GitHub App in your browser:\n${url}`),
    open: args.open,
    org,
    ownerType,
    port,
    persist: (values) => upsertEnv(envPath, values),
  })

  console.log(`\nGitHub App created and ${envPath} updated.`)

  console.log(`\nInstall it from ${installUrl}`)
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

Usage: pnpm run setup:github-app -- [options]

  --base-url <url>       devpush URL (default: http://localhost:7429)
  --app-name <name>      GitHub App name (default: unique generated name)
  --owner-type <type>    personal or org (default: personal)
  --org <slug>           Organization slug for an org-owned app
  --env <path>           Credentials file (default: app/.env)
  --port <number>        Local callback port (default: 8787)
  --no-open              Do not open the browser automatically`)
}

function trimSlash(value) {
  return value.replace(/\/+$/g, '')
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
