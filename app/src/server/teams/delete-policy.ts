import type { TeamRole } from '@/lib/team-role'

export function canDeleteTeam({
  defaultUserIds,
  ignoreDefaultForUserId,
}: {
  defaultUserIds: Array<string>
  ignoreDefaultForUserId?: string
}) {
  return defaultUserIds.every((userId) => userId === ignoreDefaultForUserId)
}

export function canDeleteProject(role: TeamRole) {
  return role === 'owner' || role === 'admin'
}
