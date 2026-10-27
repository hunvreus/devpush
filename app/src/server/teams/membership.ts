import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { TeamRole } from '#devpush/lib/team-role'
import { teamMembers, user, teams } from '#devpush/server/db/schema'

type Store = { all: <T = unknown>(query: SQL) => Promise<T[]> }
type Change = {
  teamId: string
  actorId: string
  memberId: string
} & ({ action: 'remove' } | { action: 'role'; role: TeamRole })

// Permission, target role and remaining ownership are checked inside the same
// mutation. This protects both D1 and local SQLite against competing requests.
export async function mutateTeamMembership(store: Store, change: Change) {
  const ownerRequired =
    change.action === 'role' && change.role === 'owner'
      ? sql`1`
      : sql`${teamMembers.role} = 'owner'`
  const mayManage = sql`exists (
    select 1 from ${teamMembers} as actor
    join ${user} as actor_user on actor_user.id = actor.user_id
    join ${teams} as actor_team on actor_team.id = actor.team_id
    where actor.team_id = ${change.teamId} and actor.user_id = ${change.actorId}
      and actor_user.status = 'active' and actor_team.status = 'active'
      and (actor.role = 'owner' or (actor.role = 'admin' and not (${ownerRequired})))
  )`
  const keepsOwner =
    change.action === 'role' && change.role === 'owner'
      ? sql`1`
      : sql`(${teamMembers.role} <> 'owner' or exists (
      select 1 from ${teamMembers} as other join ${user} as other_user on other_user.id = other.user_id
      where other_user.status = 'active' and other.team_id = ${change.teamId} and other.user_id <> ${change.memberId}
        and other.role = 'owner'
    ))`
  const scope = sql`${teamMembers.teamId} = ${change.teamId} and ${teamMembers.userId} = ${change.memberId}
    and ${mayManage} and ${keepsOwner}`
  const statement =
    change.action === 'role'
      ? sql`update ${teamMembers} set role = ${change.role} where ${scope} returning id`
      : sql`delete from ${teamMembers} where ${scope} returning id`
  return (await store.all<{ id: string }>(statement)).length > 0
}

export async function mutateTeamOwnership(
  store: Store,
  change: {
    teamId: string
    actorId: string
    memberId: string
  },
) {
  if (change.actorId === change.memberId) return false
  // Materialize both eligible memberships before either role changes. An
  // UPDATE subquery must not recheck the actor after demoting its first row.
  const statement = sql`with authorized as materialized (
    select actor.id as actor_id, target.id as target_id
    from ${teamMembers} as actor
    join ${teamMembers} as target on target.team_id = actor.team_id
    join ${user} as actor_user on actor_user.id = actor.user_id
    join ${user} as target_user on target_user.id = target.user_id
    join ${teams} as actor_team on actor_team.id = actor.team_id
    where actor.team_id = ${change.teamId} and actor.user_id = ${change.actorId}
      and actor.role = 'owner' and target.user_id = ${change.memberId} and target.role <> 'owner'
      and actor_user.status = 'active' and target_user.status = 'active' and actor_team.status = 'active'
  ) update ${teamMembers}
    set role = case when user_id = ${change.memberId} then 'owner' else 'admin' end
    where id in (select actor_id from authorized union all select target_id from authorized)
    returning id`
  return (await store.all(statement)).length === 2
}

export async function leaveMembership(
  store: Store,
  input: { userId: string; teamId: string },
) {
  const statement = sql`delete from ${teamMembers}
    where team_id = ${input.teamId} and user_id = ${input.userId}
      and exists(select 1 from ${user} as member_user
        where member_user.id = ${input.userId} and member_user.status = 'active'
        and (member_user.default_team_id is null or member_user.default_team_id <> ${input.teamId}))
      and (role <> 'owner' or exists(select 1 from ${teamMembers} as other join ${user} as other_user on other_user.id = other.user_id
        where other_user.status = 'active' and other.team_id = ${input.teamId} and other.user_id <> ${input.userId} and other.role = 'owner'))
    returning id`
  return (await store.all(statement)).length === 1
}
