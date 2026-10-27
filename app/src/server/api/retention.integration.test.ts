import { expect, test } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import { API_AUDIT_RETENTION_MS, pruneApiHistory } from './retention'

test('API history maintenance is bounded and preserves unexpired refresh reuse records', async () => {
  const now = Date.now()
  const actor = crypto.randomUUID()
  const client = crypto.randomUUID()
  await db.batch([
    db.run(
      sql`insert into user(id,name,username,email) values(${actor},'Retention',${actor},${actor + '@example.invalid'})`,
    ),
    db.run(
      sql`insert into oauth_client(id,client_id,redirect_uris) values(${client},${client},'[]')`,
    ),
    db.run(
      sql`insert into oauth_refresh_token(id,token,client_id,user_id,expires_at,created_at,revoked,scopes) values('retention-live','retention-live',${client},${actor},${now + 1000},${now},${now},'[]'),('retention-expired','retention-expired',${client},${actor},${now - 1000},${now},${now},'[]')`,
    ),
    db.run(sql`insert into api_audit(id,team_id,user_id,credential_id,request_id,operation,resource_id,outcome,created_at)
      with recursive n(x) as(values(0) union all select x+1 from n where x<509)
      select 'retention-'||x,'team',${actor},'credential','request','operation','resource','accepted',${now - API_AUDIT_RETENTION_MS - 1000} from n`),
  ])
  const result = await pruneApiHistory(db, now)
  expect(result.audit).toBe(500)
  expect(result.refreshTokens).toBe(1)
  const [live] = await db.all<{ id: string }>(
    sql`select id from oauth_refresh_token where id='retention-live'`,
  )
  expect(live).toBeDefined()
  const [remaining] = await db.all<{ count: number }>(
    sql`select count(*) as count from api_audit where user_id=${actor}`,
  )
  expect(
    Number(Array.isArray(remaining) ? remaining[0] : remaining?.count),
  ).toBe(10)
  await db.batch([
    db.run(sql`delete from user where id=${actor}`),
    db.run(sql`delete from oauth_client where id=${client}`),
    db.run(sql`delete from api_audit where user_id=${actor}`),
  ])
})
