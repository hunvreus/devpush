import { sql } from 'drizzle-orm'
import type { AtomicStore } from '#devpush/server/db/atomic'
import {
  teamInvites,
  teamMembers,
  teams,
  user,
} from '#devpush/server/db/schema'

export async function acceptInvitation(
  store: AtomicStore,
  input: { userId: string; inviteId: string; tokenHash: string; now: Date },
) {
  const eligible = sql`invitation.id = ${input.inviteId}
    and invitation.token_hash = ${input.tokenHash}
    and invitation.status = 'pending' and invitation.expires_at > ${input.now.getTime()}
    and invitee.id = ${input.userId} and invitee.status = 'active'
    and invitee.email_verified = 1 and lower(trim(invitee.email)) = invitation.email
    and invited_team.status = 'active'`
  const [, accepted] = await store.batch([
    store.run(sql`insert into ${teamMembers} (id, team_id, user_id, role, created_at)
      select ${crypto.randomUUID()}, invitation.team_id, invitee.id, invitation.role, ${input.now.getTime()}
      from ${teamInvites} as invitation
      join ${teams} as invited_team on invited_team.id = invitation.team_id
      join ${user} as invitee on invitee.id = ${input.userId}
      where ${eligible}
      on conflict(team_id, user_id) do nothing`),
    store.all(sql`update ${teamInvites} set status = 'accepted', updated_at = ${input.now.getTime()}
      where id in (
        select invitation.id from ${teamInvites} as invitation
        join ${teams} as invited_team on invited_team.id = invitation.team_id
        join ${user} as invitee on invitee.id = ${input.userId}
        join ${teamMembers} as membership on membership.team_id = invitation.team_id and membership.user_id = invitee.id
        where ${eligible}
      ) returning id`),
  ])
  return accepted.length === 1
}
