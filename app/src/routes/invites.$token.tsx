import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
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
import { getCurrentUserContext } from '@/server/auth/context'
import { acceptTeamInviteAction } from '@/server/teams/functions'

export const Route = createFileRoute('/invites/$token')({
  loader: async ({ params }) => {
    if (!(await getCurrentUserContext())) {
      throw redirect({
        to: '/auth/login',
        search: { redirect: `/invites/${params.token}` },
      })
    }
  },
  component: TeamInviteRoute,
})

function TeamInviteRoute() {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function accept() {
    setPending(true)
    setError(null)

    try {
      const teamSlug = await acceptTeamInviteAction({ data: { token } })
      await navigate({ to: '/$teamSlug', params: { teamSlug } })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The invitation could not be accepted.',
      )
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
          <CardContent className="text-destructive">{error}</CardContent>
        ) : null}
        <CardFooter className="justify-end gap-2">
          <Button asChild variant="ghost">
            <Link to="/settings" hash="teams">
              Cancel
            </Link>
          </Button>
          <Button disabled={pending} onClick={() => void accept()}>
            {pending ? 'Accepting…' : 'Accept invitation'}
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
