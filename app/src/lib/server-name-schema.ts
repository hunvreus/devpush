import { z } from 'zod'

export const serverNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter a server name with at least 2 characters.')
  .max(100, 'Server names must be 100 characters or fewer.')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/,
    'Use letters, numbers, dots, underscores, or hyphens. Start and end with a letter or number.',
  )
