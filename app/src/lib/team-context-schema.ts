import { z } from 'zod'

export const teamContextSectionSchema = z.enum([
  'overview',
  'servers',
  'settings',
])
export type TeamContextSection = z.infer<typeof teamContextSectionSchema>
