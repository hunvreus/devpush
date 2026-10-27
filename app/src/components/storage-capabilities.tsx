import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

export const ImageUploadsContext = createContext(true)
export function useImageUploads() {
  return useContext(ImageUploadsContext)
}

export function ImageUploadControls({ children }: { children: ReactNode }) {
  return useImageUploads() ? children : null
}
