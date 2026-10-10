import { useCallback, useEffect, useRef, useState } from 'react'

// A reset, removal, or newer selection invalidates the previous file read.
export function useAvatarInput() {
  const [dataUrl, setDataUrlState] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)
  const cancelRead = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    setPending(false)
  }, [])
  useEffect(() => () => cancelRef.current?.(), [])
  const setDataUrl = useCallback(
    (value: string | null) => {
      cancelRead()
      setDataUrlState(value)
    },
    [cancelRead],
  )
  const read = useCallback(
    (file: File) => {
      cancelRead()
      setPending(true)
      return new Promise<string | null>((resolve, reject) => {
        const reader = new FileReader()
        let settled = false
        const finish = (value: string | null, error?: Error) => {
          if (settled) return
          settled = true
          reader.onload = reader.onerror = reader.onabort = null
          cancelRef.current = null
          setPending(false)
          if (error) reject(error)
          else resolve(value)
        }
        cancelRef.current = () => {
          if (settled) return
          settled = true
          reader.onload = reader.onerror = reader.onabort = null
          if (reader.readyState === FileReader.LOADING) reader.abort()
          resolve(null)
        }
        reader.onload = () => {
          if (typeof reader.result === 'string') finish(reader.result)
          else finish(null, new Error('Unable to read image file.'))
        }
        reader.onerror = () =>
          finish(null, new Error('Unable to read image file.'))
        reader.onabort = () => finish(null)
        try {
          reader.readAsDataURL(file)
        } catch {
          finish(null, new Error('Unable to read image file.'))
        }
      })
    },
    [cancelRead],
  )
  return { dataUrl, setDataUrl, read, cancelRead, pending }
}
