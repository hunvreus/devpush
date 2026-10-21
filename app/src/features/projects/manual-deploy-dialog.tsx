import { manualDeployOptionsQueryOptions } from '@/lib/manual-deploy-options-query'
import { afterMutation } from '@/lib/action-feedback'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LoaderIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { deployProject } from '@/server/projects/functions'
import type { getProjectDeployOptions } from '@/server/projects/functions'
import { getPublicErrorMessage } from '@/lib/public-error'
import { invalidateProjectContext } from '@/lib/project-context-query'
import type { ProjectEnvironmentConfig } from '@/server/projects/types'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [selectedBranch, setSelectedBranch] = useState<string | undefined>()
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
    null
  const environmentId = selectedEnvironment?.id ?? ''
  const selectedCommit = useMemo(
    () =>
      options?.commits.find(
        (commit) => getCommitKey(commit) === selectedCommitKey,
      ) ?? null,
    [options, selectedCommitKey],
  )

  useEffect(() => {
    if (!open || !environmentId) {
      return
    }

    let canceled = false
    const queryOptions = manualDeployOptionsQueryOptions({
      environmentId,
      branch: selectedBranch,
      teamSlug,
      projectName,
    })
    const cached = queryClient.getQueryData(queryOptions.queryKey)
    setIsLoading(!cached)
    setLoadError(null)
    setSubmitError(null)
    setOptions(
      (current) =>
        cached ?? (current?.environment.id === environmentId ? current : null),
    )
    setSelectedCommitKey((current) =>
      cached?.commits.some((commit) => getCommitKey(commit) === current)
        ? current
        : cached?.commits[0]
          ? getCommitKey(cached.commits[0])
          : null,
    )
    queryClient
      .fetchQuery(queryOptions)
      .then((nextOptions) => {
        if (canceled) {
          return
        }

        setOptions(nextOptions)
        if (nextOptions.selectedBranch) {
          queryClient.setQueryData(
            manualDeployOptionsQueryOptions({
              environmentId,
              teamSlug,
              projectName,
              branch: nextOptions.selectedBranch,
            }).queryKey,
            nextOptions,
          )
        }
        setSelectedCommitKey((current) =>
          nextOptions.commits.some((commit) => getCommitKey(commit) === current)
            ? current
            : nextOptions.commits[0]
              ? getCommitKey(nextOptions.commits[0])
              : null,
        )
      })
      .catch((error) => {
        if (canceled) {
          return
        }

        setLoadError(
          getPublicErrorMessage(
            error,
            'Unable to load deploy options. Please try again.',
          ),
        )
      })
      .finally(() => {
        if (!canceled) {
          setIsLoading(false)
        }
      })

    return () => {
      canceled = true
      void queryClient.cancelQueries({
        queryKey: queryOptions.queryKey,
        exact: true,
      })
    }
  }, [
    open,
    projectName,
    environmentId,
    teamSlug,
    loadAttempt,
    queryClient,
    selectedBranch,
  ])

  const selectionMatches =
    options?.environment.id === environmentId &&
    (selectedBranch === undefined || options.selectedBranch === selectedBranch)

  async function submit(confirmed = false) {
    if (isDeploying || isLoading || loadError || disabled) return
    if (!selectedCommit || !selectedEnvironment || !selectionMatches) {
      setSubmitError('Select a commit to deploy.')
      return
    }

    if (hasActiveDeployment && !confirmed) {
      setConfirmOpen(true)
      return
    }

    setConfirmOpen(false)
    setSubmitError(null)
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
      await afterMutation(
        () =>
          invalidateProjectContext(queryClient, {
            teamSlug,
            projectName,
          }),
        'The action completed, but refreshing the data failed. Please reload.',
      )
      await afterMutation(
        () =>
          router.navigate({
            to: '/$teamSlug/projects/$projectName/deployments/$deploymentId',
            params: {
              teamSlug,
              projectName,
              deploymentId: deployment.deploymentId,
            },
          }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      setSubmitError(
        getPublicErrorMessage(error, 'Unable to deploy. Please try again.'),
      )
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isDeploying) {
            setOpen(next)
            setSubmitError(null)
          }
        }}
      >
        <DialogTrigger asChild disabled={disabled || isDeploying}>
          {children}
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto grid-cols-1 gap-4 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">{title ?? 'Deploy'}</DialogTitle>
            <DialogDescription>
              Select an environment, branch and commit to deploy.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="min-w-0 space-y-3" disabled={isDeploying}>
            <div className="flex flex-wrap items-center gap-2">
              {selectedEnvironment ? (
                <EnvironmentSelect
                  environments={environments}
                  value={selectedEnvironment.id}
                  onChange={(value) => {
                    setSelectedBranch(undefined)
                    setSelectedEnvironmentId(value)
                  }}
                />
              ) : (
                <Skeleton className="h-7 w-36" />
              )}
              {options?.environment.id === environmentId &&
              options.branches.length ? (
                <BranchSelect
                  branches={options.branches}
                  value={selectedBranch ?? options.selectedBranch ?? ''}
                  onChange={setSelectedBranch}
                />
              ) : null}
            </div>
            {!environmentId ? (
              <FieldError>
                No environments are available for deployment.
              </FieldError>
            ) : loadError ? (
              <div className="space-y-2">
                <FieldError>{loadError}</FieldError>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : isLoading || !options ? (
              <div className="space-y-3">
                <div className="max-h-[calc(5*2.75rem+2px)] overflow-y-auto scrollbar">
                  <section className="overflow-hidden rounded-lg border">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <label
                        key={index}
                        className="flex h-11 items-center gap-x-3 border-b px-4 text-sm last:border-b-0"
                      >
                        <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
                        <Skeleton className="h-4 w-14 shrink-0 bg-muted-foreground/20" />
                        <span className="flex min-w-0 shrink-0 items-center gap-x-2">
                          <Skeleton className="size-4 shrink-0 bg-muted-foreground/20" />
                          <Skeleton className="h-4 w-16 bg-muted-foreground/20" />
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-x-2">
                          <Skeleton className="size-5 shrink-0 bg-muted-foreground/20" />
                          <Skeleton className="h-4 min-w-0 flex-1 bg-muted-foreground/20" />
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
                <div className="max-h-[calc(5*2.75rem+2px)] overflow-y-auto scrollbar">
                  {options.commits.length > 0 ? (
                    <section className="overflow-hidden rounded-lg border">
                      {options.commits.map((commit) => (
                        <label
                          key={getCommitKey(commit)}
                          className="flex h-11 min-w-0 cursor-pointer items-center gap-x-3 border-b px-4 text-sm transition-colors last:border-b-0 hover:bg-muted/50"
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
                              <span className="flex min-w-0 max-w-1/4 shrink items-center gap-x-2 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-50 dark:[&>svg]:opacity-60">
                                <GitBranchIcon />
                                <span className="truncate">
                                  {commit.branch}
                                </span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Branch</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex min-w-0 flex-1 items-center gap-x-2 overflow-hidden text-muted-foreground [&>svg]:shrink-0 [&>svg]:opacity-50 dark:[&>svg]:opacity-60">
                                <GitCommitHorizontalIcon className="size-5 shrink-0" />
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
                    <section className="flex min-h-60 items-center justify-center rounded-xl border bg-card p-4 text-card-foreground">
                      <div className="max-w-sm text-center">
                        <h2 className="font-semibold">No commits</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          This branch does not have any commits yet.
                        </p>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}
          </fieldset>
          <FieldError>{submitError}</FieldError>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isDeploying}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                isDeploying ||
                isLoading ||
                selectedCommit === null ||
                loadError !== null ||
                !selectionMatches
              }
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
      <SelectTrigger
        aria-label="Deployment environment"
        size="sm"
        className="w-fit"
      >
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

function BranchSelect({
  branches,
  value,
  onChange,
}: {
  branches: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Deployment branch"
        size="sm"
        className="w-fit max-w-full"
      >
        <GitBranchIcon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {branches.map((branch) => (
          <SelectItem key={branch} value={branch}>
            {branch}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
