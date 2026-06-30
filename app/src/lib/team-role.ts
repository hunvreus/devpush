export type TeamRole = 'owner' | 'admin' | 'member'

export function canManageTeamSettings(role: TeamRole) {
  return role === 'owner' || role === 'admin'
}

export function canInviteTeamMembers(role: TeamRole) {
  return canManageTeamSettings(role)
}

export function canManageTeamMembers(role: TeamRole) {
  return role === 'owner' || role === 'admin'
}

export function canDeleteTeam(role: TeamRole) {
  return role === 'owner'
}
