import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import { cn } from '#devpush/lib/utils'
import { formatBackupAge, formatBackupUtc } from './project-backup-utils'

export function BackupTimestamp({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={value}
          className={cn(
            'w-fit shrink-0 whitespace-nowrap text-muted-foreground',
            className,
          )}
        >
          {formatBackupAge(value)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatBackupUtc(value)}</TooltipContent>
    </Tooltip>
  )
}
