import { Link } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '#devpush/components/ui/alert'
import { Button } from '#devpush/components/ui/button'
import { canManageTeamSettings } from '#devpush/lib/team-role'
import type { TeamSummary } from '#devpush/server/teams/types'
import type { ServerAvailabilityNotice } from './server-availability'

export function ServerAvailabilityAlert({
  notice,
  team,
}: {
  notice: ServerAvailabilityNotice
  team: Pick<TeamSummary, 'slug' | 'role'>
}) {
  const canManage = canManageTeamSettings(team.role)
  return (
    <Alert className="has-data-[slot=alert-action]:pr-32">
      <TriangleAlertIcon />
      <AlertTitle className="truncate">{notice.title}</AlertTitle>
      <AlertDescription>
        {notice.description}{' '}
        {canManage
          ? 'Restore the server connection to resume deployments on it.'
          : 'Contact a workspace owner or admin to restore the server connection.'}
      </AlertDescription>
      <AlertAction>
        <Button asChild variant="outline">
          <Link
            to="/$teamSlug/servers/$serverId"
            params={{ teamSlug: team.slug, serverId: notice.targetServerId }}
          >
            View server
          </Link>
        </Button>
      </AlertAction>
    </Alert>
  )
}
