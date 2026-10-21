import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { parse } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'
import { createClient } from '@libsql/client/web'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { openSqlite } from '../src/server/db/sqlite-connection'
import { openLibsql } from '../src/server/db/libsql-connection'
import { sqliteParams } from '../src/server/db/sqlite-params'
import {
  RecoveryInputError,
  deletionRecoveryPlan,
  listDeletedResourcesQuery,
  inspectDeletion,
  recoveryRows,
  recoveryTargetQuery,
} from '../src/server/deletion-recovery'
import type {
  RecoveryAction,
  RecoveryTarget,
} from '../src/server/deletion-recovery'

const help = `Deletion recovery (installation operator access required)
  pnpm cleanup:recover list [--cloudflare]
  pnpm cleanup:recover inspect <project|server|team|job|artifact> <id> [--cloudflare]
  pnpm cleanup:recover <retry-job|confirm-job|cleanup-project|confirm-artifact> <id>
    --revision <inspection revision> --operator <identity> --reason <evidence> [--apply] [--cloudflare]

Without --apply, mutations only print a preview. confirm-job attests cleanup of
all job targets; confirm-artifact attests the exact archive is already removed.
Never use confirmations to bypass cleanup or merely because a server is offline.
--cloudflare selects the main D1 binding in the generated Wrangler config.
Otherwise uses DEVPUSH_DATABASE_URL/token or an existing DEVPUSH_DATABASE_PATH.
`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      apply: { type: 'boolean' },
      cloudflare: { type: 'boolean' },
      revision: { type: 'string' },
      operator: { type: 'string' },
      reason: { type: 'string' },
    },
  })
  if (values.help) {
    console.log(help)
    return
  }
  const [command, second, third] = positionals
  const targets = ['project', 'server', 'team', 'job', 'artifact']
  const actions = [
    'retry-job',
    'confirm-job',
    'cleanup-project',
    'confirm-artifact',
  ]
  const inspect = command === 'inspect'
  const list = command === 'list' && positionals.length === 1
  if (
    (inspect &&
      (positionals.length !== 3 || !targets.includes(second ?? ''))) ||
    (!inspect &&
      !list &&
      (positionals.length !== 2 || !actions.includes(command ?? '')))
  )
    throw new RecoveryInputError(help)
  const target = (
    inspect
      ? second
      : command === 'cleanup-project'
        ? 'project'
        : command === 'confirm-artifact'
          ? 'artifact'
          : 'job'
  ) as RecoveryTarget
  const id = (inspect ? third : second)!
  const handle = values.cloudflare ? await openCloudflare() : openNode()
  try {
    if (list) {
      console.log(
        JSON.stringify(
          {
            database: handle.label,
            resources: recoveryRows(
              await handle.store.all(listDeletedResourcesQuery()),
            ),
            note: 'Limited to 101 resources, oldest first.',
          },
          null,
          2,
        ),
      )
      return
    }
    const [row] = recoveryRows(
      await handle.store.all(recoveryTargetQuery(target, id)),
    )
    if (!row)
      throw new RecoveryInputError(
        'Resource not found in the selected database.',
      )
    const revision = createHash('sha256')
      .update(JSON.stringify(row))
      .digest('hex')
    const report = await inspectDeletion(handle.store, target, row)
    if (inspect) {
      console.log(
        JSON.stringify(
          { database: handle.label, revision, ...report },
          null,
          2,
        ),
      )
      return
    }
    if (values.revision !== revision)
      throw new RecoveryInputError(
        'Inspection revision missing or stale. Inspect this target again.',
      )
    const plan = deletionRecoveryPlan({
      action: command as RecoveryAction,
      row,
      operator: values.operator ?? '',
      reason: values.reason ?? '',
      now: new Date(),
    })
    if (!values.apply) {
      console.log(
        JSON.stringify(
          {
            preview: true,
            database: handle.label,
            action: command,
            operator: values.operator,
            reason: values.reason,
            ...report,
          },
          null,
          2,
        ),
      )
      return
    }
    // Every plan starts with a guarded audit insert; native batches roll back together.
    const [first, ...rest] = plan
    const results = await handle.store.batch([
      handle.store.all(first),
      ...rest.map((query) => handle.store.run(query)),
    ])
    if (results[0].length !== 1)
      throw new RecoveryInputError(
        'Recovery target changed or is not eligible. Inspect again.',
      )
    console.log(
      JSON.stringify({
        submitted: true,
        database: handle.label,
        action: command,
        id,
        note: 'Recovery recorded. Normal maintenance performs final collection after retention and other blockers are resolved.',
      }),
    )
  } finally {
    await handle.close()
  }
}

function openNode() {
  const url = process.env.DEVPUSH_DATABASE_URL
  if (url) {
    const connection = openLibsql(
      createClient({ url, authToken: process.env.DEVPUSH_DATABASE_AUTH_TOKEN }),
      {},
    )
    return {
      store: connection.db,
      close: connection.close,
      label: 'configured libSQL main database',
    }
  }
  const path = process.env.DEVPUSH_DATABASE_PATH || '.data/devpush.sqlite'
  if (!existsSync(path))
    throw new RecoveryInputError(
      'SQLite database does not exist. Set DEVPUSH_DATABASE_PATH explicitly.',
    )
  const connection = openSqlite(path, {})
  return { store: connection.db, close: connection.close, label: path }
}

async function openCloudflare() {
  const path = process.env.DEVPUSH_WRANGLER_CONFIG || 'wrangler.jsonc'
  const errors: ParseError[] = []
  const config = parse(readFileSync(path, 'utf8'), errors, {
    allowTrailingComma: true,
  })
  const binding = config?.d1_databases?.find(
    (entry: { binding: string }) => entry.binding === 'DEVPUSH_DATABASE',
  )
  if (
    errors.length ||
    !/^[a-f0-9]{32}$/.test(config?.account_id ?? '') ||
    !/^[a-f0-9-]{36}$/.test(binding?.database_id ?? '') ||
    binding.database_id.startsWith('00000000-')
  )
    throw new RecoveryInputError(
      'An explicit account_id and real main D1 binding are required in the Wrangler config.',
    )
  const credentials = JSON.parse(
    execFileSync('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  if (typeof credentials.token !== 'string' || !credentials.token)
    throw new RecoveryInputError('Wrangler authentication required.')
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${binding.database_id}/query`
  async function request(batch: Array<{ sql: string; params: unknown[] }>) {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch: batch.map((query) => ({
          sql: query.sql,
          params: sqliteParams(query.params),
        })),
      }),
    })
    const body = (await response.json()) as {
      success?: boolean
      result?: Array<{ success?: boolean; results?: unknown[] }>
    }
    if (
      !response.ok ||
      body.success !== true ||
      body.result?.length !== batch.length ||
      body.result.some((entry) => entry.success !== true)
    )
      throw new RecoveryInputError(
        `D1 recovery request failed (${response.status}); no automatic retry. Inspect before trying again.`,
      )
    return body.result.map((entry) => ({ rows: entry.results ?? [] }))
  }
  const store = drizzle(
    async (sql, params) => (await request([{ sql, params }]))[0]!,
    (queries) => request(queries),
    {},
  )
  return {
    store,
    close: () => {},
    label: `D1 ${config.account_id}/${binding.database_id}`,
  }
}

main().catch((error: unknown) => {
  // Driver errors can include SQL parameters; never print them with credentials.
  console.error(
    error instanceof RecoveryInputError
      ? error.message
      : 'Database or authentication request failed. Inspect before retrying; driver details are withheld because they can contain secrets.',
  )
  process.exitCode = 1
})
