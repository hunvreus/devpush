import {
  BanIcon,
  CircleCheckIcon,
  CircleXIcon,
  CircleAlertIcon,
  ClockIcon,
  LoaderIcon,
} from 'lucide-react'
import type { ProjectBackupRun } from '@/server/projects/types'

export function BackupStatusIcon({
  status,
}: {
  status: ProjectBackupRun['status'] | null
}) {
  if (status === 'succeeded') {
    return (
      <CircleCheckIcon
        className="size-4 shrink-0 text-success"
      />
    )
  }
  if (status === 'queued')
    return (
      <ClockIcon
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  if (status === 'failed') {
    return (
      <CircleAlertIcon
        className="size-4 shrink-0 text-destructive"
      />
    )
  }
  if (status === 'running') {
    return (
      <LoaderIcon
        className="size-4 shrink-0 animate-spin text-muted-foreground"
      />
    )
  }
  if (status === 'canceled') {
    return (
      <CircleXIcon
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  }
  return (
    <BanIcon
      className="size-4 shrink-0 text-muted-foreground"
    />
  )
}
