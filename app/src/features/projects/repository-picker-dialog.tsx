import {
  CheckIcon,
  ChevronsUpDownIcon,
  GithubIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { Button } from '#devpush/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#devpush/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#devpush/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  RepositoryListPending,
  RepositoryToolbarPending,
} from '#devpush/features/repositories/repository-list-pending'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { repositorySelectionQueryOptions } from '#devpush/lib/repository-selection-query'
import { getRepositorySelectionRepositories } from '#devpush/server/projects/functions'
import type { RepositorySelectionContext } from '#devpush/server/projects/types'

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
  const [chosenInstallationId, setSelectedInstallationId] = useState<
    number | null
  >(currentRepo.installationId)
  const [query, setQuery] = useState('')
  const repositorySelectionQuery = useQuery({
    ...repositorySelectionQueryOptions(teamSlug),
    enabled: open,
  })
  const github = repositorySelectionQuery.data?.github
  const installations = github?.connected ? github.installations : []
  const selectedInstallationId = installations.some(
    (installation) => installation.id === chosenInstallationId,
  )
    ? chosenInstallationId
    : (installations.at(0)?.id ?? null)
  const selectedInstallation = installations.find(
    (installation) => installation.id === selectedInstallationId,
  )
  const client = useQueryClient()
  const repositoriesQuery = useQuery({
    queryKey: ['repository-picker', teamSlug, selectedInstallationId],
    enabled:
      open && Boolean(selectedInstallationId) && Boolean(github?.connected),
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => {
      if (!selectedInstallationId) throw new Error('Select an installation.')
      return getRepositorySelectionRepositories({
        data: { teamSlug, installationId: selectedInstallationId },
        signal,
      })
    },
  })
  const repositories = repositoriesQuery.data ?? []
  const reposError = repositoriesQuery.error
    ? getPublicErrorMessage(
        repositoriesQuery.error,
        'Unable to load repositories. Please try again.',
      )
    : null
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
    if (!open)
      void client.cancelQueries({
        queryKey: ['repository-picker', teamSlug, selectedInstallationId],
        exact: true,
      })
  }, [open, client, teamSlug, selectedInstallationId])

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
          {repositorySelectionQuery.isPending ? (
            <div className="space-y-4">
              <RepositoryToolbarPending />
              <RepositoryListPending />
            </div>
          ) : !repositorySelectionQuery.data ? (
            <div role="alert" className="text-sm text-destructive">
              Unable to load repositories.
              <Button
                variant="outline"
                onClick={() => void repositorySelectionQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : github?.connected ? (
            <div className="space-y-4">
              {repositorySelectionQuery.error ? (
                <p role="alert" className="text-sm text-destructive">
                  Unable to refresh repositories. Displayed information may be
                  out of date.
                </p>
              ) : null}
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

              {reposError && repositoriesQuery.data ? (
                <p role="alert" className="text-sm text-destructive">
                  Unable to refresh repositories. Displayed information may be
                  out of date.
                </p>
              ) : null}
              <div>
                {selectedInstallationId !== null &&
                repositoriesQuery.isPending ? (
                  <RepositoryListPending />
                ) : reposError && !repositoriesQuery.data ? (
                  <div
                    role="alert"
                    className="space-y-2 text-sm text-destructive"
                  >
                    <p>{reposError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void repositoriesQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : filteredRepositories.length > 0 ? (
                  <ul
                    className="overflow-hidden rounded-lg border"
                    aria-label="Repository list"
                    aria-live="polite"
                    role="listbox"
                  >
                    {filteredRepositories.map((repo) => (
                      <li
                        className="flex h-11 items-center gap-2 border-b px-4 text-sm transition-colors last:border-b-0 hover:bg-muted/50"
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
                          <CheckIcon className="ml-auto size-4 shrink-0" />
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
                  <Empty className="min-h-50 border">
                    <EmptyHeader>
                      <EmptyTitle>No repositories found.</EmptyTitle>
                      <EmptyDescription>
                        Try a different search or check which repositories the
                        GitHub App can access.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
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
