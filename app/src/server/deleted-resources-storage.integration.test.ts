import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { createD1TestStores } from '#devpush/test/d1'
import { openLibsql } from '#devpush/server/db/libsql-connection'
import * as schema from '#devpush/server/db/schema'
import {
  deletedResourceRetentionMs,
  pruneDeletedResources,
} from './deleted-resources'
import {
  encryptExistingProviderTokens,
  readProviderToken,
} from './auth/provider-tokens'

test.each(['D1', 'libSQL'] as const)(
  'final cleanup and provider-token rewrite work on %s',
  async (target) => {
    const d1 = target === 'D1' ? await createD1TestStores() : undefined
    const client =
      target === 'libSQL' ? createClient({ url: 'file::memory:' }) : undefined
    const libsql = client ? openLibsql(client, schema) : undefined
    const store = d1?.main ?? libsql?.db
    if (!store) throw new Error('Missing test store.')
    try {
      if (client) {
        await client.execute('PRAGMA foreign_keys = ON')
        const migration = readFileSync(
          fileURLToPath(
            new URL('./db/migrations-sqlite/0000_initial.sql', import.meta.url),
          ),
          'utf8',
        )
        for (const statement of migration
          .split('--> statement-breakpoint')
          .filter((value) => value.trim()))
          await client.execute(statement)
      }
      const now = new Date(),
        old = now.getTime() - deletedResourceRetentionMs - 1000
      await store.run(
        sql`insert into teams (id, name, slug, status, updated_at) values ('t', 'Team', 'team', 'deleted', ${old})`,
      )
      await store.run(
        sql`insert into servers (id, team_id, name, handle, status, updated_at) values ('s', 't', 'Server', 'server', 'deleted', ${old})`,
      )
      await store.run(
        sql`insert into projects (id, team_id, name, slug, github_repo, default_server_id, status, updated_at) values ('p', 't', 'Project', 'project', 'owner/repo', 's', 'deleted', ${old})`,
      )
      await store.run(
        sql`insert into agent_jobs (id, type, server_id, project_id, status, payload, attempt, finished_at, updated_at) values ('j', 'purge', 's', 'p', 'succeeded', '{"runtimeIds":["dp_old"]}', 1, ${old}, ${old})`,
      )
      await store.run(
        sql`insert into agent_runtime_observations (id, server_id, runtime_id, first_seen_at, last_seen_at) values ('o', 's', 'dp_old', ${old - 1000}, ${old - 1000})`,
      )
      expect(await pruneDeletedResources({ store, now })).toEqual({
        projects: 1,
        servers: 1,
        teams: 1,
        users: 0,
      })
      await store.run(
        sql`insert into user (id, name, username, email) values ('u', 'Owner', 'owner', 'owner@example.test')`,
      )
      await store.run(
        sql`insert into account (id, account_id, user_id, provider_id, access_token, refresh_token, id_token) values ('a', 'provider-user', 'u', 'github', 'gho_plain', 'refresh-plain', 'header.payload.signature')`,
      )
      expect(await encryptExistingProviderTokens({ store })).toEqual({
        checked: 1,
        encrypted: 1,
      })
      const [row] = await store.select().from(schema.account)
      expect(row!.accessToken).not.toBe('gho_plain')
      expect(await readProviderToken(row!.accessToken!)).toBe('gho_plain')
      expect(await readProviderToken(row!.refreshToken!)).toBe('refresh-plain')
      expect(await readProviderToken(row!.idToken!)).toBe(
        'header.payload.signature',
      )
    } finally {
      await d1?.runtime.dispose()
      libsql?.close()
    }
  },
  30_000,
)
