import { z } from 'zod'

export const avatarDataUrlSchema = z
  .string()
  .max(3_000_000)
  .regex(
    /^data:image\/(?:png|jpeg|webp);base64,/,
    'Upload a PNG, JPEG, or WebP image.',
  )
  .nullable()
  .optional()
