import {
  getAuthSession,
  requireAuthSession,
} from '#devpush/server/auth/session.server'
import { requireTeam } from '#devpush/server/teams/service'
import {
  requireServerForTeam,
  requireServerMetricHistoryForTeam,
  createPendingServer,
  createServerInstallCommand,
  deleteTeamServer,
  disableTeamServer,
  enableTeamServer,
  getServerDeleteDiagnostic,
  updateTeamServer,
} from '#devpush/server/servers/service'
import { settingsVersionSchema } from '#devpush/lib/settings-version'
import { publicErrorsMiddleware } from '#devpush/server/http/public-errors'
import { serverNameSchema } from '#devpush/lib/server-name-schema'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const createServerSchema = z.object({
  teamSlug: z.string().min(1),
  name: serverNameSchema,
})

const serverInstallCommandSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
})

const updateServerSchema = z.object({
  settingsVersion: settingsVersionSchema,
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
  name: serverNameSchema,
})

const disableServerSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
  confirmationName: z.string().min(1),
})

const enableServerSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
})

const deleteServerDiagnosticSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
})

const deleteServerSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
  confirmationName: z.string().min(1),
  cancelOngoingDeployments: z.boolean(),
})

export const createServer = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: { name: string; teamSlug: string }) =>
    createServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession('Sign in before adding a server.')

    return createPendingServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      name: data.name,
    })
  })

export const createInstallCommand = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: { serverId: string; teamSlug: string }) =>
    serverInstallCommandSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before enrolling a server.',
    )

    return createServerInstallCommand({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
    })
  })

export const updateServer = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      settingsVersion: number
      name: string
      serverId: string
      teamSlug: string
    }) => updateServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before updating a server.',
    )

    return updateTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
      settingsVersion: data.settingsVersion,
      name: data.name,
    })
  })

export const disableServer = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: { confirmationName: string; serverId: string; teamSlug: string }) =>
      disableServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before disabling a server.',
    )

    await disableTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
      confirmationName: data.confirmationName,
    })
  })

export const enableServer = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: { serverId: string; teamSlug: string }) =>
    enableServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before enabling a server.',
    )

    await enableTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
    })
  })

export const getDeleteServerDiagnostic = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((data: { serverId: string; teamSlug: string }) =>
    deleteServerDiagnosticSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before deleting a server.',
    )

    return getServerDeleteDiagnostic({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
    })
  })

export const deleteServer = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator(
    (data: {
      cancelOngoingDeployments: boolean
      confirmationName: string
      serverId: string
      teamSlug: string
    }) => deleteServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireAuthSession(
      'Sign in before deleting a server.',
    )

    await deleteTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
      confirmationName: data.confirmationName,
      cancelOngoingDeployments: data.cancelOngoingDeployments,
    })
  })

export const getTeamServerContext = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof serverInstallCommandSchema>) =>
    serverInstallCommandSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      return null
    }

    const team = await requireTeam(session.user.id, data.teamSlug)
    const server = await requireServerForTeam({
      teamId: team.id,
      serverId: data.serverId,
    })

    return {
      team,
      server,
    }
  })

export const getTeamServerMetricHistory = createServerFn({ method: 'GET' })
  .middleware([publicErrorsMiddleware])
  .validator((data: z.input<typeof serverInstallCommandSchema>) =>
    serverInstallCommandSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()
    if (!session) return null
    const team = await requireTeam(session.user.id, data.teamSlug)
    return requireServerMetricHistoryForTeam({
      teamId: team.id,
      serverId: data.serverId,
    })
  })
