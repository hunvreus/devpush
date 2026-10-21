import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { teamDeletionStatements } from '@/server/teams/deletion-state'
import { installationAdminPredicate } from '@/server/admin/access'

export type UserCleanupJobPayload = {
  schemaVersion: 1
  userId: string
  email: string
  avatarPath: string | null
  soleMemberOwnedTeamIds: string[]
}

export async function deleteUserState(
  store: AtomicStore,
  input: {
    userId: string
    email: string
    now: Date
    adminActorUserId?: string
  },
) {
  const now = input.now.getTime()
  const jobId = crypto.randomUUID()
  const guard = sql`u.id = ${input.userId} and u.email = ${input.email}
    and ${
      input.adminActorUserId
        ? sql`u.status in ('active', 'banned') and u.id <> ${input.adminActorUserId} and ${installationAdminPredicate(input.adminActorUserId)}`
        : sql`u.status = 'active'`
    }
    and not exists(select 1 from team_members owner join teams t on t.id = owner.team_id
      where owner.user_id = ${input.userId} and owner.role = 'owner' and t.status = 'active'
        and exists(select 1 from team_members other where other.team_id = t.id and other.user_id <> ${input.userId})
        and not exists(select 1 from team_members other_owner join user other_user on other_user.id = other_owner.user_id
          where other_owner.team_id = t.id and other_user.status = 'active'
          and other_owner.user_id <> ${input.userId} and other_owner.role = 'owner'))`
  const queued = sql`exists(select 1 from user_cleanup_jobs where id = ${jobId} and user_id = ${input.userId})`
  const [created] = await store.batch([
    store.all(sql`insert into user_cleanup_jobs (id, user_id, status, payload, available_at, created_at, updated_at)
      select ${jobId}, u.id, 'queued', json_object('schemaVersion', 1, 'userId', u.id, 'email', u.email,
        'avatarPath', u.image, 'soleMemberOwnedTeamIds', json((select json_group_array(id) from
          (select t.id from teams t join team_members sole on sole.team_id = t.id
            where t.status = 'active' and sole.user_id = ${input.userId} and sole.role = 'owner'
            and not exists(select 1 from team_members other where other.team_id = t.id and other.user_id <> ${input.userId}) order by t.id)))),
        ${now}, ${now}, ${now} from user u where ${guard} returning id`),
    store.run(sql`delete from team_invites where team_id in (
      select value from user_cleanup_jobs as cleanup, json_each(cleanup.payload, '$.soleMemberOwnedTeamIds')
      where cleanup.id = ${jobId}) and ${queued}`),
    store.run(
      sql`delete from session where user_id = ${input.userId} and ${queued}`,
    ),
    store.run(
      sql`delete from account where user_id = ${input.userId} and ${queued}`,
    ),
    store.run(sql`update user set status = 'deleted', default_team_id = null, updated_at = ${now}
      where id = ${input.userId} and ${queued}`),
  ])
  return created.length === 1
}

export async function cleanupDeletedUserState(
  store: AtomicStore,
  input: {
    payload: UserCleanupJobPayload
    now: Date
    claim: { id: string; attempt: number }
  },
) {
  const p = input.payload
  const guard = sql`exists(select 1 from user where id = ${p.userId} and status = 'deleted') and exists(select 1 from user_cleanup_jobs where id = ${input.claim.id} and user_id = ${p.userId} and status = 'running' and attempt = ${input.claim.attempt} and claimed_at = ${input.now.getTime()})`
  const statements = teamDeletionStatements({
    teamIds: sql`select id from teams where status = 'active'
      and id in (select value from json_each(${JSON.stringify(p.soleMemberOwnedTeamIds)}))
      and exists(select 1 from team_members sole where sole.team_id = teams.id and sole.user_id = ${p.userId} and sole.role = 'owner')
      and not exists(select 1 from team_members other where other.team_id = teams.id and other.user_id <> ${p.userId})`,
    guard,
    reason: 'Team deleted because the owning user was deleted.',
    message: 'Canceled because the owning user was deleted.',
    now: input.now,
    clearDefaults: true,
  })
  const [found] = await store.batch([
    store.all(sql`select id from user where id = ${p.userId} and ${guard}`),
    ...statements.map((query) => store.run(query)),
    store.run(
      sql`delete from team_invites where (inviter_id = ${p.userId} or lower(email) = ${p.email.toLowerCase()}) and ${guard}`,
    ),
    store.run(
      sql`delete from team_members where user_id = ${p.userId} and ${guard}`,
    ),
  ])
  if (found.length !== 1) throw new Error('Deleted user not found.')
}
