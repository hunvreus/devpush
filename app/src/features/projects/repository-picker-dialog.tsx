import {
  CheckIcon,
  ChevronsUpDownIcon,
  GithubIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { getErrorMessage } from '@/lib/error-message'
import {
  getNewProjectContext,
  getRepositorySelectionRepositories,
} from '@/server/projects/functions'
import type { RepositorySelectionContext } from '@/server/projects/service'

export type ProjectRepository = {
  fullName: string
  id: number | null
  installationId: number | null
}

type Repository = Extract<
  RepositorySelectionContext['github'],
  { connected: true }
>['repositories'][number]

type Installation = Extract<
  RepositorySelectionContext['github'],
  { connected: true }
>['installations'][number]

export function RepositoryPickerDialog({
  children,
  currentRepo,
  onSelect,
  teamSlug,
}: {
  children: ReactNode
  currentRepo: ProjectRepository
  onSelect: (repo: ProjectRepository) => void
  teamSlug: string
}) {
  const [open, setOpen] = useState(false)
  const [repositorySelection, setRepositorySelection] =
    useState<RepositorySelectionContext | null>(null)
  const [repositories, setRepositories] = useState<Array<Repository>>([])
  const [selectedInstallationId, setSelectedInstallationId] = useState<
    number | null
  >(currentRepo.installationId)
  const [query, setQuery] = useState('')
  const [isLoadingContext, setIsLoadingContext] = useState(false)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const github = repositorySelection?.github
  const installations = github?.connected ? github.installations : []
  const selectedInstallation = installations.find(
    (installation) => installation.id === selectedInstallationId,
  )
  const filteredRepositories = repositories
    .filter((repo) => {
      if (repo.installationId !== selectedInstallationId) {
        return false
      }

      return repo.fullName.toLowerCase().includes(query.trim().toLowerCase())
    })
    .sort(
      (first, second) =>
        new Date(second.updatedAt).getTime() -
        new Date(first.updatedAt).getTime(),
    )
    .slice(0, 5)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setIsLoadingContext(true)

    void getNewProjectContext({ data: { teamSlug } })
      .then((context) => {
        if (cancelled) {
          return
        }

        setRepositorySelection(context?.repositorySelection ?? null)

        if (context?.repositorySelection.github.connected) {
          const defaultInstallationId =
            currentRepo.installationId ??
            context.repositorySelection.github.installations.at(0)?.id ??
            null
          setSelectedInstallationId(defaultInstallationId)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(getErrorMessage(error, 'Unable to load repositories.'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingContext(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentRepo.installationId, open, teamSlug])

  useEffect(() => {
    if (!open || !selectedInstallationId || !github?.connected) {
      return
    }

    let cancelled = false
    setIsLoadingRepos(true)

    void getRepositorySelectionRepositories({
      data: { teamSlug, installationId: selectedInstallationId },
    })
      .then((nextRepositories) => {
        if (!cancelled) {
          setRepositories(nextRepositories)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(getErrorMessage(error, 'Unable to load repositories.'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRepos(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [github?.connected, open, selectedInstallationId, teamSlug])

  function selectRepository(repo: Repository) {
    onSelect({
      fullName: repo.fullName,
      id: repo.id,
      installationId: repo.installationId,
    })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select repository</DialogTitle>
          <DialogDescription>
            Choose the GitHub repository connected to this project.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar -m-4 min-h-0 overflow-y-auto p-4">
          {isLoadingContext ? (
            <div className="space-y-4">
              <RepositoryToolbarSkeleton />
              <RepoListSkeleton />
            </div>
          ) : github?.connected ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <RepositoryAccountDropdown
                  installations={installations}
                  installUrl={`/api/github/install?next=${encodeURIComponent(
                    `/${teamSlug}/settings`,
                  )}`}
                  selectedInstallation={selectedInstallation}
                  selectedInstallationId={selectedInstallationId}
                  onChange={setSelectedInstallationId}
                />
                <InputGroup className="h-8 flex-1">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={query}
                    placeholder="Search by name"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </InputGroup>
              </div>

              <div>
                {isLoadingRepos ? (
                  <RepoListSkeleton />
                ) : filteredRepositories.length > 0 ? (
                  <ul
                    aria-label="Repository list"
                    aria-live="polite"
                    role="listbox"
                  >
                    {filteredRepositories.map((repo, index) => (
                      <li
                        className={`flex h-12 items-center gap-2 border px-4 text-sm transition-colors hover:bg-muted/50 ${
                          index > 0 ? 'border-t-0' : 'rounded-t-lg'
                        } ${
                          index === filteredRepositories.length - 1
                            ? 'rounded-b-lg'
                            : ''
                        }`}
                        key={`${repo.installationId}:${repo.id}`}
                        role="option"
                      >
                        <a
                          className="truncate font-medium hover:underline"
                          href={`https://github.com/${repo.fullName}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {repo.name}
                        </a>
                        {repo.private ? (
                          <LockIcon className="size-4 shrink-0 text-muted-foreground" />
                        ) : null}
                        <p className="truncate text-muted-foreground">
                          {formatRepositoryUpdatedAt(repo.updatedAt)}
                        </p>
                        {repo.fullName === currentRepo.fullName ? (
                          <CheckIcon className="ml-auto size-4" />
                        ) : (
                          <Button
                            className="ml-auto"
                            size="xs"
                            type="button"
                            onClick={() => selectRepository(repo)}
                          >
                            Select
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex h-50 items-center justify-center rounded-lg bg-muted px-4 text-sm text-muted-foreground">
                    No repositories found
                  </p>
                )}
              </div>
            </div>
          ) : (
            <Empty className="min-h-60">
              <EmptyHeader>
                <EmptyTitle>Connect GitHub.</EmptyTitle>
                <EmptyDescription>
                  Connect GitHub before selecting a repository.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RepositoryToolbarSkeleton() {
  return (
    <div className="flex gap-2">
      <Skeleton className="h-8 w-40 shrink-0 border border-input bg-muted/70 shadow-xs dark:bg-input/40" />
      <Skeleton className="h-8 min-w-0 flex-1 border border-input bg-muted/70 shadow-xs dark:bg-input/40" />
    </div>
  )
}

function RepoListSkeleton() {
  return (
    <ul aria-label="Loading repositories" aria-live="polite">
      {Array.from({ length: 5 }).map((_, index) => (
        <li
          className={`flex h-12 items-center justify-between gap-x-2 border px-4 text-sm transition-colors hover:bg-muted/50 ${
            index > 0 ? 'border-t-0' : 'rounded-t-lg'
          } ${index === 4 ? 'rounded-b-lg' : ''}`}
          key={index}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Skeleton className="h-4 w-32 rounded bg-muted-foreground/20" />
            <Skeleton className="h-4 w-24 rounded bg-muted-foreground/20" />
          </span>
          <Button disabled size="xs" type="button">
            Select
          </Button>
        </li>
      ))}
    </ul>
  )
}

function RepositoryAccountDropdown({
  installations,
  installUrl,
  selectedInstallation,
  selectedInstallationId,
  onChange,
}: {
  installations: Array<Installation>
  installUrl: string
  selectedInstallation: Installation | undefined
  selectedInstallationId: number | null
  onChange: (installationId: number) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="w-40 justify-start gap-1.5"
          variant="outline"
          type="button"
        >
          {selectedInstallation ? (
            <img
              data-icon="inline-start"
              alt=""
              className="size-5 rounded"
              src={`https://github.com/${selectedInstallation.accountLogin}.png`}
            />
          ) : (
            <GithubIcon data-icon="inline-start" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedInstallation?.accountLogin ?? 'GitHub'}
          </span>
          <ChevronsUpDownIcon
            data-icon="inline-end"
            className="text-muted-foreground group-hover/button:text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-max min-w-(--radix-dropdown-menu-trigger-width)"
      >
        {installations.map((installation) => (
          <DropdownMenuItem
            className="whitespace-nowrap"
            key={installation.id}
            onClick={() => onChange(installation.id)}
          >
            <img
              alt=""
              className="size-5 rounded"
              src={`https://github.com/${installation.accountLogin}.png`}
            />
            {installation.accountLogin}
            {selectedInstallationId === installation.id ? (
              <CheckIcon className="ml-auto" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="whitespace-nowrap">
          <a href={installUrl}>
            <PlusIcon />
            Add GitHub account
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatRepositoryUpdatedAt(value: string) {
  const updatedAt = new Date(value)

  if (Number.isNaN(updatedAt.getTime())) {
    return 'Updated recently'
  }

  const diffMs = Date.now() - updatedAt.getTime()
  const diffDays = Math.round(diffMs / 86_400_000)

  if (diffDays < 1) {
    return 'Updated today'
  }

  if (diffDays === 1) {
    return 'Updated yesterday'
  }

  if (diffDays < 30) {
    return `Updated ${diffDays} days ago`
  }

  return updatedAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      updatedAt.getFullYear() === new Date().getFullYear()
        ? undefined
        : 'numeric',
  })
}
