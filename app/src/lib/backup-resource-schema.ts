import { z } from 'zod'

// Docker/Compose names must not be interpreted as command-line options.
export const backupResourceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
    'Select a valid Compose service or named volume.',
  )
