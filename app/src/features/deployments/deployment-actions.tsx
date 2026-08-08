import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  Redo2Icon,
  Undo2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

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
import type { DeploymentSummary } from '@/server/projects/service'

export function DeploymentActions({
  deployment,
  teamSlug,
}: {
  deployment: DeploymentSummary
  teamSlug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [redeployOpen, setRedeployOpen] = useState(false)
  const [isRedeploying, setIsRedeploying] = useState(false)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const canRedeploy =
    deployment.status !== 'queued' && deployment.status !== 'running'
  const canRollback = deployment.status === 'succeeded'

  async function redeploy() {
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
      await invalidateProjectContext(queryClient, {
        teamSlug,
        projectName: deployment.projectName,
      })
      await router.navigate({
        to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
        params: {
          teamSlug,
          projectName: deployment.projectName,
          deploymentId: nextDeployment.deploymentId,
        },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to queue redeploy.'))
    } finally {
      setIsRedeploying(false)
    }
  }

  async function rollback() {
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
      await invalidateProjectContext(queryClient, {
        teamSlug,
        projectName: deployment.projectName,
      })
      await router.navigate({
        to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
        params: {
          teamSlug,
          projectName: deployment.projectName,
          deploymentId: nextDeployment.deploymentId,
        },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to queue rollback.'))
    } finally {
      setIsRollingBack(false)
    }
  }

  return (
    <>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem
          disabled={!canRollback}
          className="whitespace-nowrap"
          onSelect={(event) => {
            event.preventDefault()

            if (canRollback) {
              setRollbackOpen(true)
            }
          }}
        >
          <Undo2Icon />
          Roll back
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canRedeploy}
          className="whitespace-nowrap"
          onSelect={(event) => {
            event.preventDefault()

            if (canRedeploy) {
              setRedeployOpen(true)
            }
          }}
        >
          <Redo2Icon />
          Redeploy
        </DropdownMenuItem>
      </DropdownMenuContent>

      <AlertDialog open={redeployOpen} onOpenChange={setRedeployOpen}>
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

      <AlertDialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
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
  deployment: DeploymentSummary
}) {
  const hasCommit = deployment.gitSha !== 'pending'

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Deploy to</h3>
        <div className="flex h-12 min-w-0 items-center gap-x-2 rounded-lg border px-3 text-sm">
          <EnvironmentDot color={deployment.environmentColor} />
          {deployment.environmentName}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Commit</h3>
        <div className="grid h-12 min-w-0 grid-cols-[auto_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-4 overflow-hidden rounded-lg border px-3 text-sm">
          <span className="shrink-0 font-mono font-medium">
            {deployment.gitSha.slice(0, 7)}
          </span>
          <span className="flex min-w-0 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
            <GitBranchIcon />
            <span className="truncate">{deployment.gitBranch}</span>
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50">
            <GitCommitHorizontalIcon />
            <span className="truncate">
              {deployment.commitMessage ?? 'Commit message unavailable'}
            </span>
          </span>
          {hasCommit ? (
            <a
              href={`https://github.com/${deployment.githubRepo}/commit/${deployment.gitSha}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View commit on GitHub"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpRightIcon className="size-4" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
