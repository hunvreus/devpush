import { and, eq, sql } from 'drizzle-orm'
import { db } from '#devpush/server/db'
import {
  notificationPreferences,
  notificationMutes,
  projects,
  teams,
  teamMembers,
  user,
} from '#devpush/server/db/schema'
import {
  defaultNotificationPreferences,
  notificationPreferencesSchema,
} from '#devpush/lib/notification-preferences'
import type { NotificationScope } from '#devpush/lib/notification-preferences'
import { PublicError } from '#devpush/lib/public-error'

export async function readNotificationPreferences(userId: string) {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)
  return {
    preferences: { ...defaultNotificationPreferences, ...row?.preferences },
    version: row?.version ?? 0,
  }
}
export async function saveNotificationPreferences(
  userId: string,
  preferences: unknown,
  version: number,
) {
  const parsed = notificationPreferencesSchema.parse(preferences)
  const [active] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.status, 'active')))
    .limit(1)
  if (!active) throw new PublicError('UNAUTHORIZED')
  const savedRows =
    version === 0
      ? await db
          .insert(notificationPreferences)
          .values({ userId, preferences: parsed, version: 1 })
          .onConflictDoNothing()
          .returning()
      : await db
          .update(notificationPreferences)
          .set({
            preferences: parsed,
            version: sql`${notificationPreferences.version}+1`,
          })
          .where(
            and(
              eq(notificationPreferences.userId, userId),
              eq(notificationPreferences.version, version),
            ),
          )
          .returning()
  const saved = savedRows[0]
  if (!saved) throw new PublicError('SETTINGS_CONFLICT')
  return { preferences: saved.preferences, version: saved.version }
}
async function requireNotificationScope(
  userId: string,
  scope: NotificationScope,
) {
  const rows =
    scope.kind === 'workspace'
      ? await db
          .select({ teamId: teams.id, projectId: sql<string | null>`null` })
          .from(teams)
          .where(and(eq(teams.id, scope.id), eq(teams.status, 'active')))
          .limit(1)
      : await db
          .select({ teamId: projects.teamId, projectId: projects.id })
          .from(projects)
          .innerJoin(teams, eq(teams.id, projects.teamId))
          .where(
            and(
              eq(projects.id, scope.id),
              eq(projects.status, 'active'),
              eq(teams.status, 'active'),
            ),
          )
          .limit(1)
  const row = rows[0]
  if (!row) throw new PublicError('PROJECT_NOT_FOUND')
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, row.teamId),
        eq(user.status, 'active'),
      ),
    )
    .limit(1)
  if (!member) throw new PublicError('PROJECT_NOT_FOUND')
  return row
}
export async function readNotificationMute(
  userId: string,
  scope: NotificationScope,
) {
  await requireNotificationScope(userId, scope)
  const [row] = await db
    .select({ id: notificationMutes.id })
    .from(notificationMutes)
    .where(eq(notificationMutes.id, `${userId}:${scope.kind}:${scope.id}`))
    .limit(1)
  return { muted: Boolean(row) }
}
export async function saveNotificationMute(
  userId: string,
  scope: NotificationScope,
  muted: boolean,
) {
  const target = await requireNotificationScope(userId, scope)
  const id = `${userId}:${scope.kind}:${scope.id}`
  if (muted)
    await db
      .insert(notificationMutes)
      .values({ id, userId, ...target })
      .onConflictDoNothing()
  else await db.delete(notificationMutes).where(eq(notificationMutes.id, id))
  return { muted }
}
