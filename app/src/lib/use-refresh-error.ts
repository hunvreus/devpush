import { useEffect } from 'react'
import { toast } from 'sonner'

export function useRefreshError(error: unknown, id: string) {
  useEffect(() => {
    if (error) {
      toast.error(
        'Unable to refresh. Displayed information may be out of date. Please reload.',
        { id },
      )
    } else {
      toast.dismiss(id)
    }
    return () => {
      toast.dismiss(id)
    }
  }, [error, id])
}
