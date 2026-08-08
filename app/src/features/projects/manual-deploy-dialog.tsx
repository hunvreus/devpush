import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LoaderIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import {
  deployProject,
  getProjectDeployOptions,
} from '@/server/projects/functions'
import { getErrorMessage } from '@/lib/error-message'
import { invalidateProjectContext } from '@/lib/project-context-query'
import type { ProjectEnvironmentConfig } from '@/server/projects/service'

type DeployOptions = Awaited<ReturnType<typeof getProjectDeployOptions>>

export function ManualDeployDialog({
  children,
  disabled,
  environments,
  hasActiveDeployment,
  projectName,
  teamSlug,
  title,
}: {
  children: React.ReactNode
  disabled?: boolean
  environments: Array<ProjectEnvironmentConfig>
  hasActiveDeployment: boolean
  projectName: string
  teamSlug: string
  title?: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [options, setOptions] = useState<DeployOptions | null>(null)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(
    () => environments.at(0)?.id ?? '',
  )
  const [selectedCommitKey, setSelectedCommitKey] = useState<string | null>(
    null,
  )
  const selectedEnvironment =
    environments.find(
      (environment) => environment.id === selectedEnvironmentId,
    ) ??
    environments.at(0) ??
    options?.environment ??
    null
  const selectedCommit = useMemo(
    () =>
      options?.commits.find(
        (commit) => getCommitKey(commit) === selectedCommitKey,
      ) ?? null,
    [options, selectedCommitKey],
  )

  useEffect(() => {
    if (!open || !selectedEnvironmentId) {
      return
    }

    let canceled = false
    setIsLoading(true)
    setOptions(null)
    setSelectedCommitKey(null)
    getProjectDeployOptions({
      data: {
        environmentId: selectedEnvironmentId,
        teamSlug,
        projectName,
      },
    })
      .then((nextOptions) => {
        if (canceled) {
          return
        }

        setOptions(nextOptions)
        setSelectedCommitKey(
          nextOptions.commits.at(0)
            ? getCommitKey(nextOptions.commits[0])
            : null,
        )
      })
      .catch((error) => {
        if (canceled) {
          return
        }

        toast.error(getErrorMessage(error, 'Unable to load deploy options.'))
      })
      .finally(() => {
        if (!canceled) {
          setIsLoading(false)
        }
      })

    return () => {
      canceled = true
    }
  }, [open, projectName, selectedEnvironmentId, teamSlug])

  async function submit(confirmed = false) {
    if (!selectedCommit || !selectedEnvironment) {
      toast.error('Select a commit to deploy.')
      return
    }

    if (hasActiveDeployment && !confirmed) {
      setConfirmOpen(true)
      return
    }

    setConfirmOpen(false)
    setIsDeploying(true)

    try {
      const deployment = await deployProject({
        data: {
          teamSlug,
          projectName,
          environmentId: selectedEnvironment.id,
          gitBranch: selectedCommit.branch,
          gitSha: selectedCommit.sha,
        },
      })

      setOpen(false)
      setOptions(null)
      await invalidateProjectContext(queryClient, {
        teamSlug,
        projectName,
      })
      await router.navigate({
        to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
        params: {
          teamSlug,
          projectName,
          deploymentId: deployment.deploymentId,
        },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to deploy.'))
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild disabled={disabled}>
          {children}
        </DialogTrigger>
        <DialogContent className="gap-4 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">{title ?? 'Deploy'}</DialogTitle>
            <DialogDescription>
              Select an environment to deploy to, and the commit you want to
              deploy.
            </DialogDescription>
          </DialogHeader>

          {isLoading || !options ? (
            <div className="space-y-3">
              {selectedEnvironment ? (
                <EnvironmentSelect
                  environments={environments}
                  value={selectedEnvironment.id}
                  onChange={setSelectedEnvironmentId}
                />
              ) : (
                <Skeleton className="h-8 w-36" />
              )}
              <div className="h-60 overflow-y-auto scrollbar">
                <section>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <label
                      key={index}
                      className="flex h-12 items-center gap-x-3 border border-b-0 px-4 text-sm first:rounded-t-lg last:rounded-b-lg last:border-b"
                    >
                      <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
                      <span className="flex min-w-0 flex-1">
                        <Skeleton className="h-4 flex-1 bg-muted-foreground/20" />
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        disabled
                      >
                        <ArrowUpRightIcon />
                      </Button>
                    </label>
                  ))}
                </section>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <EnvironmentSelect
                environments={environments}
                value={selectedEnvironment?.id ?? options.environment.id}
                onChange={setSelectedEnvironmentId}
              />

              <div className="h-60 overflow-y-auto scrollbar">
                {options.commits.length > 0 ? (
                  <section>
                    {options.commits.map((commit) => (
                      <label
                        key={commit.sha}
                        className="flex h-12 min-w-0 cursor-pointer items-center gap-x-3 border border-b-0 bg-clip-padding px-4 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg last:border-b hover:bg-muted/50"
                      >
                        <input
                          type="radio"
                          name="deploy-commit"
                          className="size-3.5 shrink-0 accent-foreground"
                          checked={selectedCommitKey === getCommitKey(commit)}
                          onChange={() =>
                            setSelectedCommitKey(getCommitKey(commit))
                          }
                        />
                        <span className="shrink-0 font-mono text-[13px] font-medium">
                          {commit.sha.slice(0, 7)}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex min-w-0 shrink-0 items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50 dark:[&>svg]:opacity-60">
                              <GitBranchIcon />
                              <span className="truncate">{commit.branch}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Branch</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex min-w-0 flex-1 items-center gap-x-2 overflow-hidden text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50 dark:[&>svg]:opacity-60">
                              <GitCommitHorizontalIcon />
                              <span className="min-w-0 truncate">
                                {commit.message?.split('\n').at(0) ??
                                  commit.sha}
                              </span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Commit message</TooltipContent>
                        </Tooltip>
                        {commit.url ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                asChild
                                variant="ghost"
                                size="icon-sm"
                                className="ml-auto"
                              >
                                <a
                                  href={commit.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`View commit ${commit.sha.slice(0, 7)} on GitHub`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <ArrowUpRightIcon />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View on GitHub</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </label>
                    ))}
                  </section>
                ) : (
                  <section className="flex min-h-60 items-center justify-center rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
                    <div className="max-w-sm text-center">
                      <h2 className="font-semibold">No commits</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        This environment does not have any matching commits yet.
                      </p>
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isDeploying || isLoading || selectedCommit === null}
              onClick={() => void submit()}
            >
              {isDeploying ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel current deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              Starting this deployment will cancel the current deployment for
              this environment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit(true)}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function getCommitKey(commit: { branch: string; sha: string }) {
  return `${commit.branch}\u0000${commit.sha}`
}

function EnvironmentSelect({
  environments,
  onChange,
  value,
}: {
  environments: Array<ProjectEnvironmentConfig>
  onChange: (value: string) => void
  value: string
}) {
  const selectedEnvironment =
    environments.find((environment) => environment.id === value) ??
    environments.at(0)

  return (
    <Select value={selectedEnvironment?.id ?? value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-fit">
        <SelectValue>
          {selectedEnvironment ? (
            <span className="flex items-center gap-2">
              <EnvironmentDot color={selectedEnvironment.color} />
              {selectedEnvironment.name}
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {environments.map((environment) => (
          <SelectItem key={environment.id} value={environment.id}>
            <span className="flex items-center gap-2">
              <EnvironmentDot color={environment.color} />
              {environment.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
