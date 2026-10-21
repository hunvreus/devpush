import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
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
