import { createServerFn } from '@tanstack/react-start'
import { requireAuthSession } from '@/server/auth/session.server'
import { publicErrorsMiddleware } from '@/server/http/public-errors'
import { accountSettingsSchema } from '@/lib/account-settings-schema'
import { updateUserGeneral } from './service'

export const confirmProfile = createServerFn({ method: 'POST' })
  .middleware([publicErrorsMiddleware])
  .validator((input: unknown) => accountSettingsSchema.parse(input))
  .handler(async ({ data }) => {
    const session = await requireAuthSession()
    return updateUserGeneral({
      ...data,
      userId: session.user.id,
      confirmProfile: true,
    })
  })
