import { and, eq } from 'drizzle-orm'
import { PublicError } from '@/lib/public-error'
import { db } from '@/server/db'
import { projects, teams, teamMembers, user } from '@/server/db/schema'
import { getProjectContext } from './context'

/** Resolve editable records by ID so a concurrent rename remains a conflict. */
export async function getProjectSettingsContext(input: {
  userId: string
  teamSlug: string
  projectName: string
  projectId?: string
  settingsVersion?: number
  scope: 'shell' | 'settings' | 'backups'
  reloadSection?: 'settings' | 'backups'
}) {
  if (!input.projectId) return getProjectContext(input)
  const [current] = await db
    .select({
      name: projects.name,
      teamSlug: teams.slug,
      settingsVersion: projects.settingsVersion,
    })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, teams.id),
        eq(teamMembers.userId, input.userId),
      ),
    )
    .innerJoin(
      user,
      and(eq(user.id, teamMembers.userId), eq(user.status, 'active')),
    )
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.status, 'active'),
        eq(teams.status, 'active'),
      ),
    )
    .limit(1)
  if (!current) throw new PublicError('SETTINGS_CONFLICT')
  if (
    current.name !== input.projectName ||
    current.teamSlug !== input.teamSlug ||
    (input.settingsVersion !== undefined &&
      current.settingsVersion !== input.settingsVersion)
  ) {
    throw new PublicError(
      'SETTINGS_CONFLICT',
      `/${encodeURIComponent(current.teamSlug)}/projects/${encodeURIComponent(current.name)}/${input.reloadSection === 'backups' || input.scope === 'backups' ? 'backups' : 'settings'}`,
    )
  }
  return getProjectContext(input)
}
