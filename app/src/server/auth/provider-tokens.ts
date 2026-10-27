import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { and, eq, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type * as schema from '#devpush/server/db/schema'
import { config } from '#devpush/server/config'
import { safeErrorDiagnostics } from '#devpush/server/http/error-diagnostics'
import { db } from '#devpush/server/db'
import { account } from '#devpush/server/db/schema'

// Better Auth's single-secret encryption format. Use the same key/codec as
// encryptOAuthTokens so refresh and reconnect never switch storage formats.
// Bare hex includes a 24-byte nonce and 16-byte authentication tag. Shorter
// hex strings (including legacy GitHub tokens) cannot be encrypted envelopes.
function isEncrypted(value: string) {
  return (
    value.startsWith('$ba$') ||
    (value.length >= 80 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value))
  )
}

export async function readProviderToken(value: string) {
  return isEncrypted(value)
    ? symmetricDecrypt({ key: config.BETTER_AUTH_SECRET, data: value })
    : value
}

export async function storeProviderToken(value: string) {
  if (isEncrypted(value)) {
    await readProviderToken(value)
    return value
  }
  return symmetricEncrypt({ key: config.BETTER_AUTH_SECRET, data: value })
}

// Bounded, restartable data rewrite shared by Node, D1 and libSQL maintenance.
// CAS all three tokens together so a concurrent provider refresh wins intact.
export async function encryptExistingProviderTokens({
  limit = 100,
  store = db,
}: {
  limit?: number
  store?: Pick<
    BaseSQLiteDatabase<'async', unknown, typeof schema>,
    'select' | 'update'
  >
} = {}) {
  const plaintext = (
    column: SQL,
  ) => sql`${column} is not null and ${column} <> ''
    and substr(${column}, 1, 4) <> '$ba$'
    and not (length(${column}) >= 80 and length(${column}) % 2 = 0 and ${column} not glob '*[^0-9a-fA-F]*')`
  const rows = await store
    .select()
    .from(account)
    .where(
      or(
        plaintext(sql`${account.accessToken}`),
        plaintext(sql`${account.refreshToken}`),
        plaintext(sql`${account.idToken}`),
      ),
    )
    .limit(Math.max(1, Math.min(100, Math.trunc(limit))))
  let updated = 0
  for (const row of rows) {
    const [accessToken, refreshToken, idToken] = await Promise.all(
      [row.accessToken, row.refreshToken, row.idToken].map((value) =>
        value ? storeProviderToken(value) : value,
      ),
    )
    try {
      const changed = await store
        .update(account)
        .set({ accessToken, refreshToken, idToken, updatedAt: row.updatedAt })
        .where(
          and(
            eq(account.id, row.id),
            eq(account.updatedAt, row.updatedAt),
            sql`${account.accessToken} is ${row.accessToken}`,
            sql`${account.refreshToken} is ${row.refreshToken}`,
            sql`${account.idToken} is ${row.idToken}`,
          ),
        )
        .returning({ id: account.id })
      updated += changed.length
    } catch (error) {
      // Drizzle query errors include original token parameters. Do not let them
      // reach the scheduler/framework logger, including through Error.cause.
      console.error(
        'Provider-token rewrite failed.',
        safeErrorDiagnostics(error),
      )
      throw new Error('Unable to encrypt existing provider tokens.')
    }
  }
  return { checked: rows.length, encrypted: updated }
}
