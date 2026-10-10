import { useQueryClient } from '@tanstack/react-query'
import { invalidateResourceQueries } from '@/lib/resource-cache'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { acceptTeamInviteAction } from '@/server/teams/functions'
import { getErrorMessage } from '@/lib/error-message'
import { afterMutation } from '@/lib/action-feedback'

export function TeamInvite({ token }: { token: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [accepted, setAccepted] = useState(false)

  async function accept() {
    if (pending || accepted) return
    setPending(true)
    setError(null)

    try {
      const teamSlug = await acceptTeamInviteAction({ data: { token } })
      await invalidateResourceQueries(queryClient)
      setAccepted(true)
      await afterMutation(
        () => navigate({ to: '/$teamSlug', params: { teamSlug } }),
        'Invitation accepted, but opening the team failed. Please reload.',
      )
    } catch (cause) {
      setError(getErrorMessage(cause, 'The invitation could not be accepted.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join this team?</CardTitle>
          <CardDescription>
            Accept the invitation to add this team to your devpush account.
          </CardDescription>
        </CardHeader>
        {error ? (
          <CardContent role="alert" className="text-destructive">
            {error}
          </CardContent>
        ) : null}
        <CardFooter className="justify-end gap-2">
          {pending ? (
            <Button variant="ghost" disabled>
              Cancel
            </Button>
          ) : (
            <Button asChild variant="ghost">
              <Link to="/settings" hash="teams">
                {accepted ? 'Account settings' : 'Cancel'}
              </Link>
            </Button>
          )}
          <Button
            data-accept-invite
            disabled={pending || accepted}
            onClick={() => void accept()}
          >
            {pending
              ? 'Accepting…'
              : accepted
                ? 'Invitation accepted'
                : 'Accept invitation'}
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}

export function TeamInvitePending() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card
        className="w-full max-w-md"
        aria-label="Loading invitation"
        aria-busy="true"
      >
        <CardHeader>
          <CardTitle>Join this team?</CardTitle>
          <CardDescription>
            Accept the invitation to add this team to your devpush account.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" disabled>
            Cancel
          </Button>
          <Button disabled>Accept invitation</Button>
        </CardFooter>
      </Card>
    </main>
  )
}
