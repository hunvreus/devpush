import { sql } from 'drizzle-orm'
import type { AtomicStore } from '@/server/db/atomic'
import { teamMembers, teams, user } from '@/server/db/schema'

type TeamInput = {
  userId: string
  teamId: string
  name: string
  baseSlug: string
}

function teamSlug(input: TeamInput) {
  return sql`case when exists(select 1 from ${teams} where slug = ${input.baseSlug})
    then ${`${input.baseSlug.slice(0, 32)}-${input.teamId.slice(0, 7)}`}
    else ${input.baseSlug} end`
}

export async function insertOwnedTeam(store: AtomicStore, input: TeamInput) {
  const now = Date.now()
  const [created] = await store.batch([
    store.all(sql`insert into ${teams} (id, name, slug, created_at, updated_at)
      select ${input.teamId}, ${input.name}, ${teamSlug(input)}, ${now}, ${now}
      from ${user} where id = ${input.userId} and status = 'active' returning id`),
    store.run(sql`insert into ${teamMembers} (id, team_id, user_id, role, created_at)
      select ${crypto.randomUUID()}, id, ${input.userId}, 'owner', ${now}
      from ${teams} where id = ${input.teamId}`),
  ])
  return created.length === 1
}

export async function bootstrapOwnedTeam(store: AtomicStore, input: TeamInput) {
  const now = Date.now()
  const activeMemberships = sql`select membership.team_id from ${teamMembers} as membership
    join ${teams} as member_team on member_team.id = membership.team_id
    where membership.user_id = ${input.userId} and member_team.status = 'active'`
  const [, , updated] = await store.batch([
    store.run(sql`insert into ${teams} (id, name, slug, created_at, updated_at)
      select ${input.teamId}, ${input.name}, ${teamSlug(input)}, ${now}, ${now}
      from ${user} where id = ${input.userId} and status = 'active'
      and not exists(${activeMemberships})`),
    store.run(sql`insert into ${teamMembers} (id, team_id, user_id, role, created_at)
      select ${crypto.randomUUID()}, id, ${input.userId}, 'owner', ${now}
      from ${teams} where id = ${input.teamId}`),
    store.all(sql`update ${user} set default_team_id = case
      when default_team_id in (${activeMemberships}) then default_team_id
      else (${activeMemberships} order by membership.created_at desc limit 1) end,
      updated_at = ${now}
      where id = ${input.userId} and status = 'active' returning id`),
  ])
  return updated.length === 1
}
