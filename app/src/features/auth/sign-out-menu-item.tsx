import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DropdownMenuItem } from '#devpush/components/ui/dropdown-menu'
import { authClient } from '#devpush/lib/auth/client'
import { afterMutation } from '#devpush/lib/action-feedback'
import { getErrorMessage } from '#devpush/lib/error-message'

export function SignOutMenuItem() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  return (
    <DropdownMenuItem
      variant="destructive"
      className="whitespace-nowrap"
      disabled={pending}
      onClick={async (event) => {
        event.preventDefault()
        setPending(true)
        try {
          const result = await authClient.signOut()
          if (result.error) throw result.error
          queryClient.clear()
          await afterMutation(
            () => router.navigate({ to: '/auth/login' }),
            'You signed out, but opening the login page failed. Please reload.',
          )
        } catch (error) {
          toast.error(
            getErrorMessage(error, 'Unable to sign out. Please try again.'),
          )
        } finally {
          setPending(false)
        }
      }}
    >
      Sign out
    </DropdownMenuItem>
  )
}
