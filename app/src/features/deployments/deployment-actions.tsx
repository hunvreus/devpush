import { useRouter } from '@tanstack/react-router'
import { Redo2Icon, Undo2Icon } from 'lucide-react'
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
import type { DeploymentSummary } from '@/server/projects/service'

export function DeploymentActions({
  deployment,
  teamSlug,
}: {
  deployment: DeploymentSummary
  teamSlug: string
}) {
  const router = useRouter()
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
          Roll back to this deployment
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
            <AlertDialogTitle>Redeploy this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will queue a new deployment using the same snapshot from{' '}
              {deployment.id.slice(0, 7)}. Any queued or running deployment for{' '}
              {deployment.environmentName} will be canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
            <AlertDialogTitle>Roll back deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will queue {deployment.id.slice(0, 7)} again with its
              original snapshot, including build inputs, environment variables,
              server, and routing settings. Any queued or running deployment for{' '}
              {deployment.environmentName} will be canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
