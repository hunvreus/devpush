import { createClient } from '@libsql/client/web'
import type { D1Database } from '@cloudflare/workers-types'
import { openD1 } from './d1-connection'
import { openLibsql } from './libsql-connection'
import { remoteDatabaseConfig } from './remote-config'
import * as schema from './schema'
import * as logSchema from './log-schema'

type DatabaseEnvironment = Parameters<typeof remoteDatabaseConfig>[0] & {
  DEVPUSH_DATABASE?: D1Database
  DEVPUSH_LOG_DATABASE?: D1Database
}

export function openWorkerDatabases(env: DatabaseEnvironment) {
  const remote = remoteDatabaseConfig(env)
  if (remote)
    return {
      db: openLibsql(() => createClient(remote.main), schema).db,
      logsDb: openLibsql(() => createClient(remote.logs), logSchema).db,
    }
  if (!env.DEVPUSH_DATABASE || !env.DEVPUSH_LOG_DATABASE)
    throw new Error('Configure both D1 bindings or both remote database URLs.')
  return {
    db: openD1(env.DEVPUSH_DATABASE, schema),
    logsDb: openD1(env.DEVPUSH_LOG_DATABASE, logSchema),
  }
}

// Cloudflare's upload validation can evaluate modules before resource bindings
// are available. Resolve the stores when application code first uses them.
export function createWorkerDatabases(env: DatabaseEnvironment) {
  let stores: ReturnType<typeof openWorkerDatabases> | undefined
  const getStores = () => (stores ??= openWorkerDatabases(env))
  function lazy<TStore extends object>(getStore: () => TStore): TStore {
    return new Proxy({} as TStore, {
      get(_target, property) {
        const store = getStore()
        const value: unknown = Reflect.get(store, property, store)
        return typeof value === 'function' ? value.bind(store) : value
      },
    })
  }
  return {
    db: lazy(() => getStores().db),
    logsDb: lazy(() => getStores().logsDb),
  }
}
