import { createServerFn } from '@tanstack/react-start'
import { isObjectStorageConfigured } from './object-store'

export const getStorageCapabilities = createServerFn({ method: 'GET' }).handler(
  async () => ({ imageUploads: isObjectStorageConfigured() }),
)
