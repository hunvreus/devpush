import { useQuery, useQueryClient } from '@tanstack/react-query'
import { operationLogsQueryOptions } from '#devpush/lib/operation-logs-query'
import { useEffect, useState, useMemo } from 'react'
import { AlertCircleIcon, LoaderIcon } from 'lucide-react'
import { Alert, AlertDescription } from '#devpush/components/ui/alert'
import { Button } from '#devpush/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#devpush/components/ui/dialog'
import { LogScrollArea } from '#devpush/features/logs/log-scroll-area'

export function BackupJobLogs({
  operation,
  teamSlug,
  onClose,
}: {
  operation: {
    type: 'backup' | 'restore'
    id: string
    errorMessage: string | null
  } | null
  teamSlug: string
  onClose: () => void
}) {
  const [lastOperation, setLastOperation] = useState(operation)
  if (operation && operation !== lastOperation) setLastOperation(operation)
  const displayedOperation = operation ?? lastOperation
  return (
    <Dialog
      open={operation !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {displayedOperation?.type === 'restore'
              ? 'Restore logs'
              : 'Backup logs'}
          </DialogTitle>
          <DialogDescription>
            Output from this{' '}
            {displayedOperation?.type === 'restore' ? 'restore' : 'backup'}{' '}
            operation. Logs are retained for up to 14 days.
          </DialogDescription>
        </DialogHeader>
        {displayedOperation ? (
          <JobLogViewer
            key={`${displayedOperation.type}:${displayedOperation.id}`}
            operation={displayedOperation}
            teamSlug={teamSlug}
            active={operation !== null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
function JobLogViewer({
  operation,
  active,
  teamSlug,
}: {
  operation: {
    type: 'backup' | 'restore'
    id: string
    errorMessage: string | null
  }
  active: boolean
  teamSlug: string
}) {
  const client = useQueryClient()
  const options = useMemo(
    () =>
      operationLogsQueryOptions(
        { teamSlug, type: operation.type, id: operation.id },
        client,
      ),
    [teamSlug, operation.type, operation.id, client],
  )
  const query = useQuery({ ...options, enabled: active })
  const content = query.data?.content ?? ''
  const loading = query.isPending
  const message = query.error instanceof Error ? query.error.message : null
  useEffect(() => {
    if (!active)
      void client.cancelQueries({ queryKey: options.queryKey, exact: true })
  }, [active, client, options.queryKey])
  return (
    <div className="space-y-3">
      {operation.errorMessage ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{operation.errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <AlertCircleIcon />
          <AlertDescription>
            {message}{' '}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <LogScrollArea
        className="h-96 rounded-lg border bg-background p-4"
        followKey={content.length}
      >
        {content ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">
            {content}
          </pre>
        ) : (
          <div
            className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            {loading ? (
              <>
                <LoaderIcon className="size-4 shrink-0 animate-spin" />
                Loading logs
              </>
            ) : (
              'No log output available.'
            )}
          </div>
        )}
      </LogScrollArea>
    </div>
  )
}
