import { afterMutation } from '@/lib/action-feedback'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRightIcon, Redo2Icon, Undo2Icon } from 'lucide-react'
import { useState } from 'react'
import { FieldError } from '@/components/ui/field'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  redeployProjectDeployment,
  rollbackProjectDeployment,
} from '@/server/projects/functions'
import { getErrorMessage } from '@/lib/error-message'
import { invalidateProjectContext } from '@/lib/project-context-query'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import type { DeploymentSummary } from '@/server/projects/types'

type ActionDeployment = Pick<
  DeploymentSummary,
  | 'id'
  | 'status'
  | 'projectName'
  | 'gitSha'
  | 'gitBranch'
  | 'environmentName'
  | 'environmentColor'
  | 'commitMessage'
  | 'githubRepo'
>

export function DeploymentActions({
  deployment,
  teamSlug,
}: {
  deployment: ActionDeployment
  teamSlug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [redeployOpen, setRedeployOpen] = useState(false)
  const [isRedeploying, setIsRedeploying] = useState(false)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const busy = isRedeploying || isRollingBack
  const canRedeploy =
    deployment.status !== 'queued' && deployment.status !== 'running'
  const canRollback = deployment.status === 'succeeded'

  async function redeploy() {
    if (busy || !canRedeploy) return
    setActionError(null)
    setIsRedeploying(true)

    try {
      const nextDeployment = await redeployProjectDeployment({
        data: {
          teamSlug,
          projectName: deployment.projectName,
          deploymentId: deployment.id,
        },
      })

      setRedeployOpen(false)
      await afterMutation(
        () =>
          invalidateProjectContext(queryClient, {
            teamSlug,
            projectName: deployment.projectName,
          }),
        'The action completed, but refreshing the data failed. Please reload.',
      )
      await afterMutation(
        () =>
          router.navigate({
            to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
            params: {
              teamSlug,
              projectName: deployment.projectName,
              deploymentId: nextDeployment.deploymentId,
            },
          }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      setActionError(
        getErrorMessage(error, 'Unable to queue redeploy. Please try again.'),
      )
    } finally {
      setIsRedeploying(false)
    }
  }

  async function rollback() {
    if (busy || !canRollback) return
    setActionError(null)
    setIsRollingBack(true)

    try {
      const nextDeployment = await rollbackProjectDeployment({
        data: {
          teamSlug,
          projectName: deployment.projectName,
          deploymentId: deployment.id,
        },
      })

      setRollbackOpen(false)
      await afterMutation(
        () =>
          invalidateProjectContext(queryClient, {
            teamSlug,
            projectName: deployment.projectName,
          }),
        'The action completed, but refreshing the data failed. Please reload.',
      )
      await afterMutation(
        () =>
          router.navigate({
            to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
            params: {
              teamSlug,
              projectName: deployment.projectName,
              deploymentId: nextDeployment.deploymentId,
            },
          }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      setActionError(
        getErrorMessage(error, 'Unable to queue rollback. Please try again.'),
      )
    } finally {
      setIsRollingBack(false)
    }
  }

  return (
    <>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem
          disabled={!canRollback || busy}
          className="whitespace-nowrap"
          onSelect={(event) => {
            event.preventDefault()

            if (canRollback && !busy) {
              setActionError(null)
              setRollbackOpen(true)
            }
          }}
        >
          <Undo2Icon />
          Roll back
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canRedeploy || busy}
          className="whitespace-nowrap"
          onSelect={(event) => {
            event.preventDefault()

            if (canRedeploy && !busy) {
              setActionError(null)
              setRedeployOpen(true)
            }
          }}
        >
          <Redo2Icon />
          Redeploy
        </DropdownMenuItem>
      </DropdownMenuContent>

      <AlertDialog
        open={redeployOpen}
        onOpenChange={(next) => {
          if (!busy) {
            setRedeployOpen(next)
            setActionError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Redeploy {deployment.gitSha.slice(0, 7)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deploy this commit again using its saved configuration. Any queued
              or running deployment for {deployment.environmentName} will be
              canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DeploymentActionSummary deployment={deployment} />
          <FieldError>{actionError}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRedeploying}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRedeploying}
              onClick={(event) => {
                event.preventDefault()
                void redeploy()
              }}
            >
              Redeploy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rollbackOpen}
        onOpenChange={(next) => {
          if (!busy) {
            setRollbackOpen(next)
            setActionError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Roll back to {deployment.gitSha.slice(0, 7)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Make this commit current for {deployment.environmentName} using
              its saved configuration. Any queued or running deployment for the
              environment will be canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DeploymentActionSummary deployment={deployment} />
          <FieldError>{actionError}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRollingBack}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRollingBack}
              onClick={(event) => {
                event.preventDefault()
                void rollback()
              }}
            >
              Roll back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DeploymentActionSummary({
  deployment,
}: {
  deployment: ActionDeployment
}) {
  const hasCommit = deployment.gitSha !== 'pending'

  return (
    <dl className="divide-y rounded-lg border text-sm">
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
        <dt className="text-muted-foreground">Environment</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <EnvironmentDot color={deployment.environmentColor} />
          <span className="break-words">{deployment.environmentName}</span>
        </dd>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
        <dt className="text-muted-foreground">Commit</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="font-mono font-medium">
            {deployment.gitSha.slice(0, 7)}
          </span>
          {hasCommit ? (
            <a
              href={`https://github.com/${deployment.githubRepo}/commit/${deployment.gitSha}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View commit on GitHub"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpRightIcon className="size-4 shrink-0" />
            </a>
          ) : null}
        </dd>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
        <dt className="text-muted-foreground">Branch</dt>
        <dd className="min-w-0 break-words">{deployment.gitBranch}</dd>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
        <dt className="text-muted-foreground">Message</dt>
        <dd className="min-w-0 break-words">
          {deployment.commitMessage ?? 'Commit message unavailable'}
        </dd>
      </div>
    </dl>
  )
}
