import { and, eq, gt } from 'drizzle-orm'
import { auth } from '@/server/auth/better-auth'
import { db } from '@/server/db'
import {
  session,
  teamMembers,
  teams,
  user,
  servers,
  projects,
} from '@/server/db/schema'
import { getWorkspaceUpdates } from '@/server/runtime/platform-env'
import { resolveProxyRequest } from '@/server/http/proxy-request'

export async function authorizeWorkspaceUpdates(request: Request) {
  request = resolveProxyRequest(request)
  const origin = request.headers.get('Origin')
  const upgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
  if (
    (upgrade && !origin) ||
    (origin && origin !== new URL(request.url).origin)
  )
    return new Response('Origin not allowed', { status: 403 })
  const current = await auth.api.getSession({ headers: request.headers })
  if (!current) return new Response('Unauthorized', { status: 401 })
  const slug = new URL(request.url).searchParams.get('team')
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(
      and(
        eq(teams.slug, slug ?? ''),
        eq(teamMembers.userId, current.user.id),
        eq(teams.status, 'active'),
        eq(user.status, 'active'),
      ),
    )
    .limit(1)
  if (!team) return new Response('Workspace not found', { status: 404 })
  return {
    teamId: team.id,
    sessionId: current.session.id,
    expiresAt: new Date(current.session.expiresAt).getTime(),
  }
}

export async function connectWorkspaceUpdates(request: Request) {
  const authorization = await authorizeWorkspaceUpdates(request)
  if (authorization instanceof Response) return authorization
  const upgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
  const namespace = getWorkspaceUpdates()
  if (!upgrade) return Response.json({ available: Boolean(namespace) })
  if (!namespace) return new Response('Use HTTP polling', { status: 501 })
  const headers = new Headers(request.headers)
  headers.set('x-devpush-session', authorization.sessionId)
  headers.set('x-devpush-session-expires', String(authorization.expiresAt))
  return namespace
    .getByName(authorization.teamId)
    .fetch(new Request(request.url, { headers }))
}

// Notifications are hints after committed writes. Delivery failure must not fail
// an acknowledged mutation; slow recovery polling repairs missed notifications.
export async function notifyWorkspace(
  teamId: string,
  kind: 'deployments' | 'servers' | 'logs',
) {
  const namespace = getWorkspaceUpdates()
  if (!namespace) return
  try {
    const active = await db
      .select({ id: session.id })
      .from(session)
      .innerJoin(teamMembers, eq(teamMembers.userId, session.userId))
      .innerJoin(user, eq(user.id, session.userId))
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          gt(session.expiresAt, new Date()),
          eq(user.status, 'active'),
          eq(teams.status, 'active'),
        ),
      )
    await namespace.getByName(teamId).publish(
      kind,
      active.map((row) => row.id),
    )
  } catch (error) {
    console.error('Workspace notification failed', error)
  }
}

export async function notifyServer(
  serverId: string,
  kind: 'deployments' | 'servers' | 'logs',
) {
  if (!getWorkspaceUpdates()) return
  try {
    const [server] = await db
      .select({ teamId: servers.teamId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1)
    if (server) await notifyWorkspace(server.teamId, kind)
  } catch (error) {
    console.error('Server notification failed', error)
  }
}

export async function notifyProject(projectId: string) {
  if (!getWorkspaceUpdates()) return
  try {
    const [project] = await db
      .select({ teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (project) await notifyWorkspace(project.teamId, 'deployments')
  } catch (error) {
    console.error('Project notification failed', error)
  }
}
