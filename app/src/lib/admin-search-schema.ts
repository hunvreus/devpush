import { z } from 'zod'

export const adminSearchSchema = z.object({
  userQuery: z.string().trim().max(255).catch(''),
  userPage: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  allowlistQuery: z.string().trim().max(255).catch(''),
  allowlistPage: z.coerce.number().int().min(1).max(1_000_000).catch(1),
})
