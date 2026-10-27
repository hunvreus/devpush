import { useQueryClient } from '@tanstack/react-query'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#devpush/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#devpush/components/ui/card'
import {
  acceptTeamInviteAction,
  declineTeamInviteAction,
} from '#devpush/server/teams/functions'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { afterMutation } from '#devpush/lib/action-feedback'

export function TeamInvite({ token }: { token: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<
    'accept' | 'decline' | null
  >(null)
  const pending = pendingAction !== null

  const [accepted, setAccepted] = useState(false)
  const [declined, setDeclined] = useState(false)

  async function accept() {
    if (pending || accepted || declined) return
    setPendingAction('accept')
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
      setError(
        getPublicErrorMessage(cause, 'The invitation could not be accepted.'),
      )
    } finally {
      setPendingAction(null)
    }
  }

  async function decline() {
    if (pending || accepted || declined) return
    setPendingAction('decline')
    setError(null)
    try {
      await declineTeamInviteAction({ data: { token } })
      setDeclined(true)
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient)
        await navigate({ to: '/settings', hash: 'teams' })
      }, 'Invitation declined, but opening Account failed. Please reload.')
    } catch (cause) {
      setError(
        getPublicErrorMessage(cause, 'The invitation could not be declined.'),
      )
    } finally {
      setPendingAction(null)
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
        <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
          {pending ? (
            <Button variant="ghost" disabled>
              Cancel
            </Button>
          ) : (
            <Button asChild variant="ghost">
              <Link to="/settings" hash="teams">
                {accepted || declined ? 'Account' : 'Cancel'}
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={pending || accepted || declined}
            onClick={() => void decline()}
          >
            {pendingAction === 'decline'
              ? 'Declining…'
              : declined
                ? 'Invitation declined'
                : 'Decline invitation'}
          </Button>
          <Button
            data-accept-invite
            disabled={pending || accepted || declined}
            onClick={() => void accept()}
          >
            {pendingAction === 'accept'
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
        <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled>
            Cancel
          </Button>
          <Button variant="outline" disabled>
            Decline invitation
          </Button>
          <Button disabled>Accept invitation</Button>
        </CardFooter>
      </Card>
    </main>
  )
}
