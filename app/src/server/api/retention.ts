import { sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import type { AtomicStore } from '#devpush/server/db/atomic'

export const API_AUDIT_RETENTION_MS = 30 * 86400_000
const batchSize = 500

// Expired idempotency records may remain longer than the guaranteed replay
// window until maintenance runs. A maintenance run always does bounded work.
export async function pruneApiHistory(
  store: AtomicStore = db,
  now = Date.now(),
) {
  const auditBefore = now - API_AUDIT_RETENTION_MS
  const [idempotency, audit, accessTokens, refreshTokens] = await store.batch([
    store.all<{ id: string }>(sql`delete from api_idempotency where id in
      (select id from api_idempotency where expires_at <= ${now} order by expires_at limit ${batchSize}) returning id`),
    store.all<{ id: string }>(sql`delete from api_audit where id in
      (select id from api_audit where created_at < ${auditBefore} order by created_at limit ${batchSize}) returning id`),
    store.all<{ id: string }>(sql`delete from oauth_access_token where id in
      (select id from oauth_access_token where expires_at <= ${now} order by expires_at limit ${batchSize}) returning id`),
    // Preserve revoked/rotated refresh rows until expiry: their families still
    // need reuse detection while any token in that family can be presented.
    store.all<{ id: string }>(sql`delete from oauth_refresh_token where id in
      (select id from oauth_refresh_token where expires_at <= ${now} order by expires_at limit ${batchSize}) returning id`),
  ])
  return {
    idempotency: idempotency.length,
    audit: audit.length,
    accessTokens: accessTokens.length,
    refreshTokens: refreshTokens.length,
  }
}
