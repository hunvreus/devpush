import type { TeamRole } from '#devpush/lib/team-role'

export function canDeleteTeam({
  defaultUserIds,
}: {
  defaultUserIds: Array<string>
}) {
  return defaultUserIds.length === 0
}

export function canDeleteProject(role: TeamRole) {
  return role === 'owner' || role === 'admin'
}
