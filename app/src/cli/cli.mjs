#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { confirm, isCancel, select } from '@clack/prompts'
import { configure } from './setup.mjs'
import { createProject, readInstallation } from './project.mjs'
import { readJsonConfig } from '../../../scripts/setup-config.mjs'
import { getD1Bindings } from '../../../scripts/d1-config.mjs'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const metadata = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = process.argv.slice(2)
const command = args.shift()

function run(command, args, cwd, env = process.env) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? done()
        : reject(
            new Error(
              `${command} failed (${code ?? 'signal'}). Your project is saved; fix the error and rerun the command.`,
            ),
          ),
    )
  })
}
async function answer(prompt) {
  const value = await prompt
  if (isCancel(value)) process.exit(0)
  return value
}
function values(root, target) {
  const path = resolve(
    root,
    target === 'cloudflare' ? '.cloudflare-secrets.json' : '.env',
  )
  return {
    ...process.env,
    ...(target === 'cloudflare'
      ? (readJsonConfig(path) ?? {})
      : existsSync(path)
        ? parseEnv(readFileSync(path, 'utf8'))
        : {}),
  }
}
async function migrate(root, target) {
  const env = values(root, target)
  if (target === 'cloudflare') {
    const config = readJsonConfig(resolve(root, 'wrangler.jsonc'))
    if (!config) throw new Error('Run npm run configure first.')
    Object.assign(env, config.vars)
    if (!env.DEVPUSH_DATABASE_URL) {
      for (const binding of getD1Bindings(config))
        await run(
          npm,
          [
            'exec',
            '--',
            'wrangler',
            'd1',
            'migrations',
            'apply',
            binding.binding,
            '--remote',
            '--config',
            'wrangler.jsonc',
          ],
          root,
          env,
        )
      return
    }
  }
  const { migrateNode } = await import(
    new URL('./migrate.mjs', import.meta.url).href
  )
  await migrateNode(env)
}
async function deploy(root, target) {
  if (target === 'docker') {
    await run('docker', ['compose', 'up', '-d', '--build'], root)
  } else {
    const config = readJsonConfig(resolve(root, 'wrangler.jsonc'))
    if (!config) throw new Error('Run npm run configure first.')
    if (!values(root, target).DEVPUSH_DATABASE_URL) getD1Bindings(config)
    const approved = await answer(
      confirm({
        message: `Deploy Worker ${config.name} in account ${config.account_id}, applying migrations to ${config.d1_databases?.map((item) => item.database_name).join(', ') || 'the configured remote databases'}?`,
        initialValue: true,
      }),
    )
    if (!approved) return
    const env = {
      ...values(root, target),
      ...config.vars,
      DEVPUSH_DEPLOY_TARGET: 'cloudflare',
    }
    await run(npm, ['run', 'build'], root, env)
    await migrate(root, target)
    await run(
      npm,
      [
        'exec',
        '--',
        'wrangler',
        'deploy',
        '--config',
        'dist/server/wrangler.json',
        '--secrets-file',
        '.cloudflare-secrets.json',
      ],
      root,
      env,
    )
  }
}
async function main() {
  if (!command || ['--help', '-h', 'help'].includes(command)) {
    console.log(
      'Usage: npx devpush@latest init [directory] [--target docker|cloudflare] [--no-install]\n\nCreates a standalone installation using the devpush npm package.\nInside an installation: npm run configure | npm run deploy | npm run migrate\n--no-install only creates files; run npm install and npm run configure afterward.',
    )
    return
  }
  if (command === '--version') return console.log(metadata.version)
  if (command === 'init') {
    let directory = 'devpush',
      target,
      noInstall = false,
      hasDirectory = false
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]
      if (arg === '--target') {
        target = args[++index]
        if (!['docker', 'cloudflare'].includes(target))
          throw new Error('--target must be docker or cloudflare.')
      } else if (arg === '--no-install') noInstall = true
      else if (arg.startsWith('-') || hasDirectory)
        throw new Error(`Unknown argument: ${arg}`)
      else {
        directory = arg
        hasDirectory = true
      }
    }
    target ??= await answer(
      select({
        message: 'Where should the dashboard run?',
        options: [
          { value: 'docker', label: 'Docker Compose' },
          { value: 'cloudflare', label: 'Cloudflare Workers' },
        ],
      }),
    )
    const root = createProject(
      directory,
      target,
      metadata,
      readFileSync(resolve(packageRoot, 'wrangler.template.jsonc'), 'utf8'),
      JSON.parse(
        readFileSync(
          resolve(packageRoot, 'dist/package/dependency-overrides.json'),
          'utf8',
        ),
      ),
    )
    console.log(`Created ${root}`)
    if (noInstall) {
      console.log(
        'Next: npm install, then npm run configure in that directory.',
      )
      return
    }
    await run(npm, ['install'], root)
    // Run the installed version so setup and future commands use identical code.
    await run(npm, ['run', 'configure'], root)
    return
  }
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(' ')}`)
  const root = process.cwd()
  if (command === 'migrate') {
    // Container images deliberately contain only the package manifest and build output.
    if (
      existsSync(resolve(root, 'devpush.json')) &&
      readInstallation(root).target === 'docker'
    )
      return run(
        'docker',
        ['compose', 'run', '--build', '--rm', 'migrate'],
        root,
      )
    return migrate(
      root,
      existsSync(resolve(root, 'devpush.json'))
        ? readInstallation(root).target
        : 'docker',
    )
  }
  const { target } = readInstallation(root)
  if (command === 'configure') {
    const result = await configure({
      root,
      packageMode: true,
      target,
      templatePath:
        target === 'cloudflare'
          ? resolve(root, 'wrangler.template.jsonc')
          : undefined,
    })
    if (result === false) return
    if (target === 'docker')
      console.log(
        `Provide an HTTPS reverse proxy to 127.0.0.1:${values(root, target).DEVPUSH_HTTP_PORT || '7429'}. Database and upload volumes must be backed up separately.`,
      )
    if (target === 'cloudflare') return deploy(root, target)
    const start = await answer(
      confirm({
        message: 'Build and start devpush with Docker Compose now?',
        initialValue: true,
      }),
    )
    if (start) await deploy(root, target)
  } else if (command === 'deploy') await deploy(root, target)
  else throw new Error(`Unknown command: ${command}`)
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
