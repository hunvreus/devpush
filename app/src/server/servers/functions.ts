import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { getAuthSession } from '@/server/auth/session.server'
import {
  createPendingServer,
  createServerInstallCommand,
  deleteTeamServer,
  disableTeamServer,
  enableTeamServer,
  getServerDeleteDiagnostic,
  updateTeamServer,
} from '@/server/servers/service'

const serverMachineNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
    'Server names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
  )

const createServerSchema = z.object({
  teamSlug: z.string().min(1),
  name: serverMachineNameSchema,
})

const serverInstallCommandSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
})

const updateServerSchema = z.object({
  teamSlug: z.string().min(1),
  serverId: z.string().min(1),
  name: serverMachineNameSchema,
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
  .validator((data: { name: string; teamSlug: string }) =>
    createServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before adding a server.')
    }

    return createPendingServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      name: data.name,
    })
  })

export const createInstallCommand = createServerFn({ method: 'POST' })
  .validator((data: { serverId: string; teamSlug: string }) =>
    serverInstallCommandSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before enrolling a server.')
    }

    return createServerInstallCommand({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
    })
  })

export const updateServer = createServerFn({ method: 'POST' })
  .validator((data: { name: string; serverId: string; teamSlug: string }) =>
    updateServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before updating a server.')
    }

    await updateTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
      name: data.name,
    })
  })

export const disableServer = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      confirmationName: string
      serverId: string
      teamSlug: string
    }) => disableServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before disabling a server.')
    }

    await disableTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
      confirmationName: data.confirmationName,
    })
  })

export const enableServer = createServerFn({ method: 'POST' })
  .validator((data: { serverId: string; teamSlug: string }) =>
    enableServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before enabling a server.')
    }

    await enableTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
    })
  })

export const getDeleteServerDiagnostic = createServerFn({ method: 'POST' })
  .validator((data: { serverId: string; teamSlug: string }) =>
    deleteServerDiagnosticSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before deleting a server.')
    }

    return getServerDeleteDiagnostic({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
    })
  })

export const deleteServer = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      cancelOngoingDeployments: boolean
      confirmationName: string
      serverId: string
      teamSlug: string
    }) => deleteServerSchema.parse(data),
  )
  .handler(async ({ data }) => {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('Sign in before deleting a server.')
    }

    await deleteTeamServer({
      userId: session.user.id,
      teamSlug: data.teamSlug,
      serverId: data.serverId,
      confirmationName: data.confirmationName,
      cancelOngoingDeployments: data.cancelOngoingDeployments,
    })
  })
