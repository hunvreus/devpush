import { SparkleIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#devpush/components/ui/tooltip'

export function DeploymentAliasBadge({
  alias,
  className = '',
}: {
  alias?: 'current' | 'previous' | null
  className?: string
}) {
  if (!alias) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex h-5 items-center gap-x-1 rounded-md bg-secondary px-2 text-xs font-medium ${alias === 'current' ? 'text-secondary-foreground' : 'text-muted-foreground'} ${className}`}
        >
          {alias === 'current' ? (
            <SparkleIcon className="size-3 shrink-0" />
          ) : null}
          {alias === 'current' ? 'Current' : 'Previous'}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {alias === 'current'
          ? 'Latest successful deployment'
          : 'Previous successful deployment'}
      </TooltipContent>
    </Tooltip>
  )
}
