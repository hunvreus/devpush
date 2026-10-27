import { NewProjectPendingContent } from './new-project-pending'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'
import { createProjectSchema } from '#devpush/lib/project-creation-schema'
import { afterMutation } from '#devpush/lib/action-feedback'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  GitBranchIcon,
  GithubIcon,
  LoaderIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '#devpush/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import { Textarea } from '#devpush/components/ui/textarea'
import { RepositoryListPending } from '#devpush/features/repositories/repository-list-pending'
import { ServerAvatar } from '#devpush/features/servers/server-avatar'
import { authClient } from '#devpush/lib/auth/client'
import { getErrorMessage } from '#devpush/lib/error-message'
import { repositorySelectionQueryOptions } from '#devpush/lib/repository-selection-query'
import { teamShellQueryOptions } from '#devpush/lib/team-context-query'
import {
  createProject,
  getRepositorySelectionRepositories,
} from '#devpush/server/projects/functions'
import type { RepositorySelectionContext } from '#devpush/server/projects/types'
import type { ServerSummary, TeamSummary } from '#devpush/server/teams/types'

type Repository = Extract<
  RepositorySelectionContext['github'],
  { connected: true }
>['repositories'][number]

type Installation = Extract<
  RepositorySelectionContext['github'],
  { connected: true }
>['installations'][number]

type NewProjectFieldErrors = Partial<
  Record<
    | 'form'
    | 'composePath'
    | 'envVars'
    | 'projectName'
    | 'readinessPath'
    | 'releaseCommand'
    | 'releaseService'
    | 'serverId',
    string
  >
>

function NewProjectDialogData({
  team,
  servers,
  onPendingChange,
  onCreated,
}: {
  team: TeamSummary
  servers: Array<ServerSummary>
  onPendingChange: (pending: boolean) => void
  onCreated: () => void
}) {
  const { data, error, isPending } = useQuery(
    repositorySelectionQueryOptions(team.slug),
  )

  if (isPending) {
    return <NewProjectPendingContent />
  }

  if (!data) {
    return (
      <NewProjectErrorContent
        error={getErrorMessage(error, 'Unable to load repositories.')}
      />
    )
  }

  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Unable to refresh repositories. Displayed information may be out of
          date.
        </p>
      ) : null}
      <NewProjectDialogContent
        team={team}
        servers={servers}
        onPendingChange={onPendingChange}
        onCreated={onCreated}
        repositorySelection={data}
      />
    </>
  )
}

function NewProjectDialogContent({
  team,
  servers,
  onPendingChange,
  onCreated,
  repositorySelection,
}: {
  team: TeamSummary
  servers: Array<ServerSummary>
  onPendingChange: (pending: boolean) => void
  onCreated: () => void
  repositorySelection: RepositorySelectionContext
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const github = repositorySelection.github
  const installations = github.connected ? github.installations : []
  const initialInstallationId = installations.at(0)?.id ?? null
  const initialRepositories = github.connected ? github.repositories : []
  const hasInitialRepositories =
    initialInstallationId !== null &&
    initialRepositories.some(
      (repo) => repo.installationId === initialInstallationId,
    )
  const [step, setStep] = useState<'repository' | 'configure'>('repository')
  const [chosenInstallationId, setSelectedInstallationId] = useState<
    number | null
  >(initialInstallationId)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [projectName, setProjectName] = useState('')
  const [serverId, setServerId] = useState<string | null>(
    servers.at(0)?.id ?? null,
  )
  const [composePath, setComposePath] = useState('')
  const [releaseCommand, setReleaseCommand] = useState('')
  const [releaseService, setReleaseService] = useState('')
  const [readinessPath, setReadinessPath] = useState('')
  const [envVars, setEnvVars] = useState<
    Array<{ id: string; key: string; value: string }>
  >([])
  const [projectCreated, setProjectCreated] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<NewProjectFieldErrors>({})
  const [query, setQuery] = useState('')
  const searchQuery = query.trim().toLowerCase()
  const [isCreating, setIsCreating] = useState(false)
  const selectedInstallationId = chosenInstallationId ?? initialInstallationId
  const repositoryQuery = useQuery({
    queryKey: ['installation-repositories', team.slug, selectedInstallationId],
    queryFn: () =>
      getRepositorySelectionRepositories({
        data: { teamSlug: team.slug, installationId: selectedInstallationId! },
      }),
    enabled:
      github.connected &&
      github.appConfigured &&
      selectedInstallationId !== null,
    initialData:
      hasInitialRepositories && selectedInstallationId === initialInstallationId
        ? initialRepositories
        : undefined,
    staleTime: 30_000,
  })
  const repositories = repositoryQuery.data ?? []
  const reposError = repositoryQuery.error
    ? getErrorMessage(
        repositoryQuery.error,
        'Unable to load repositories. Please try again.',
      )
    : null

  const selectedInstallation = installations.find(
    (installation) => installation.id === selectedInstallationId,
  )
  const filteredRepos = useMemo(() => {
    const repos = repositories
      .filter((repo) => repo.installationId === selectedInstallationId)
      .sort(
        (first, second) =>
          new Date(second.updatedAt).getTime() -
          new Date(first.updatedAt).getTime(),
      )

    if (!searchQuery) {
      return repos.slice(0, 5)
    }

    return repos
      .filter((repo) => repo.fullName.toLowerCase().includes(searchQuery))
      .sort((first, second) => {
        const firstName = first.fullName.toLowerCase()
        const secondName = second.fullName.toLowerCase()

        return (
          Number(!firstName.startsWith(searchQuery)) -
            Number(!secondName.startsWith(searchQuery)) ||
          firstName.length - secondName.length
        )
      })
      .slice(0, 5)
  }, [searchQuery, repositories, selectedInstallationId])

  const [isConnecting, setIsConnecting] = useState(false)
  async function connectGitHub() {
    setIsConnecting(true)
    try {
      const result = await authClient.signIn.social({
        provider: 'github',
        callbackURL: `/${team.slug}/new-project`,
      })
      if (result.error) throw result.error
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to connect GitHub.'))
      setIsConnecting(false)
    }
  }

  function getInstallGitHubAppUrl() {
    return `/api/github/install?next=${encodeURIComponent(`/${team.slug}/new-project`)}`
  }

  async function submitProject() {
    if (!selectedRepo || isCreating || projectCreated) {
      return
    }

    setFieldErrors({})
    const parsed = createProjectSchema.safeParse({
      teamSlug: team.slug,
      projectName,
      repoFullName: selectedRepo.fullName,
      installationId: selectedRepo.installationId,
      serverId: serverId ?? '',
      composePath,
      readinessPath,
      releaseCommand,
      releaseService,
      envVars: envVars
        .filter((envVar) => envVar.key.trim() || envVar.value)
        .map((envVar) => ({
          key: envVar.key,
          value: envVar.value,
          environment: 'production',
        })),
    })
    if (!parsed.success) {
      const errors: NewProjectFieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        const field =
          key === 'projectName' ||
          key === 'composePath' ||
          key === 'readinessPath' ||
          key === 'releaseCommand' ||
          key === 'releaseService' ||
          key === 'envVars' ||
          key === 'serverId'
            ? key
            : 'form'
        errors[field] ??=
          field === 'envVars' && typeof issue.path[1] === 'number'
            ? `Variable ${issue.path[1] + 1}: ${issue.message}`
            : issue.message
      }
      setFieldErrors(errors)
      const fields: Record<string, string> = {
        projectName: 'new-project-name',
        composePath: 'new-project-compose-path',
        readinessPath: 'new-project-readiness-path',
        releaseCommand: 'new-project-release-command',
        releaseService: 'new-project-release-service',
        serverId: 'new-project-server',
      }
      const first = Object.keys(errors)[0] ?? ''
      if (first === 'envVars')
        document
          .querySelector<HTMLInputElement>(
            '#new-project-form input[placeholder="KEY"]',
          )
          ?.focus()
      else document.getElementById(fields[first] ?? 'new-project-form')?.focus()
      return
    }
    setIsCreating(true)
    onPendingChange(true)
    try {
      const project = await createProject({ data: parsed.data })
      setProjectCreated(true)
      onCreated()
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient, team.slug)
        await router.navigate({
          to: '/$teamSlug/projects/$projectName',
          params: {
            teamSlug: team.slug,
            projectName: project.name,
          },
        })
      }, 'The action completed, but opening the next page failed. Please reload.')
    } catch (error) {
      setFieldErrors(getNewProjectFieldErrors(error))
    } finally {
      setIsCreating(false)
      onPendingChange(false)
    }
  }

  function selectRepository(repo: Repository) {
    setSelectedRepo(repo)
    setProjectName(repo.name)
    setFieldErrors({})
    setStep('configure')
  }

  return (
    <>
      <DialogHeader
        className={
          step === 'configure'
            ? '-mx-4 -mt-4 border-b px-4 pt-4 pb-4'
            : undefined
        }
      >
        <DialogTitle>Create project</DialogTitle>
        <DialogDescription>
          Select a repository, then confirm the initial deployment defaults.
        </DialogDescription>
      </DialogHeader>

      {github.connected ? (
        step === 'repository' ? (
          <RepositoryStep
            appConfigured={github.appConfigured}
            filteredRepos={filteredRepos}
            installUrl={getInstallGitHubAppUrl()}
            installations={installations}
            isLoading={repositoryQuery.isPending}
            error={reposError}
            onRetry={() => void repositoryQuery.refetch()}
            onInstallAccountChange={(installationId) => {
              setSelectedInstallationId(installationId)
              setSelectedRepo(null)
            }}
            onQueryChange={setQuery}
            onSelectRepo={selectRepository}
            query={query}
            selectedInstallation={selectedInstallation}
            selectedInstallationId={selectedInstallationId}
          />
        ) : (
          <>
            <form
              id="new-project-form"
              noValidate
              className="scrollbar -m-4 min-h-0 overflow-y-auto p-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submitProject()
              }}
            >
              <fieldset disabled={isCreating || projectCreated}>
                <ConfigureStep
                  projectName={projectName}
                  repository={selectedRepo}
                  selectedServerId={serverId}
                  servers={servers}
                  composePath={composePath}
                  envVars={envVars}
                  fieldErrors={fieldErrors}
                  readinessPath={readinessPath}
                  releaseCommand={releaseCommand}
                  releaseService={releaseService}
                  onAddEnvVar={() =>
                    setEnvVars((current) => [
                      ...current,
                      { id: crypto.randomUUID(), key: '', value: '' },
                    ])
                  }
                  onComposePathChange={(value) => {
                    setComposePath(value)
                    setFieldErrors((current) => ({
                      ...current,
                      composePath: undefined,
                    }))
                  }}
                  onEnvVarChange={(id, update) => {
                    setFieldErrors((current) => ({
                      ...current,
                      envVars: undefined,
                    }))
                    setEnvVars((current) =>
                      current.map((envVar) =>
                        envVar.id === id ? { ...envVar, ...update } : envVar,
                      ),
                    )
                  }}
                  onProjectNameChange={(value) => {
                    setProjectName(value)
                    setFieldErrors((current) => ({
                      ...current,
                      projectName: undefined,
                    }))
                  }}
                  onReadinessPathChange={(value) => {
                    setReadinessPath(value)
                    setFieldErrors((current) => ({
                      ...current,
                      readinessPath: undefined,
                    }))
                  }}
                  onReleaseCommandChange={(value) => {
                    setReleaseCommand(value)
                    setFieldErrors((current) => ({
                      ...current,
                      releaseCommand: undefined,
                    }))
                  }}
                  onReleaseServiceChange={(value) => {
                    setReleaseService(value)
                    setFieldErrors((current) => ({
                      ...current,
                      releaseService: undefined,
                    }))
                  }}
                  onRemoveEnvVar={(id) =>
                    setEnvVars((current) =>
                      current.filter((envVar) => envVar.id !== id),
                    )
                  }
                  onServerChange={setServerId}
                />
                <FieldError role="alert">{fieldErrors.form}</FieldError>
              </fieldset>
            </form>
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                type="button"
                disabled={isCreating || projectCreated}
                onClick={() => setStep('repository')}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
              <Button
                disabled={!selectedRepo || isCreating || projectCreated}
                type="submit"
                form="new-project-form"
              >
                {isCreating ? (
                  <LoaderIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : null}
                Create project
              </Button>
            </DialogFooter>
          </>
        )
      ) : (
        <ConnectGitHub
          busy={isConnecting}
          onConnect={() => void connectGitHub()}
        />
      )}
    </>
  )
}

export function NewProjectRouteDialog({ teamSlug }: { teamSlug: string }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)
  if (created) return null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !creating)
          void router
            .navigate({ to: '/$teamSlug', params: { teamSlug } })
            .catch(() =>
              toast.error(
                'Unable to close project creation. Please try again.',
              ),
            )
      }}
    >
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
        <NewProjectDialogOverlayContent
          teamSlug={teamSlug}
          onPendingChange={setCreating}
          onCreated={() => setCreated(true)}
        />
      </DialogContent>
    </Dialog>
  )
}

export function NewProjectDialogOverlayContent({
  onPendingChange,
  onCreated,
  teamSlug,
}: {
  onPendingChange: (pending: boolean) => void
  onCreated: () => void
  teamSlug: string
}) {
  const {
    data: context,
    error,
    isPending,
  } = useQuery(teamShellQueryOptions({ teamSlug }))

  return (
    <>
      {isPending ? (
        <NewProjectPendingContent />
      ) : !context ? (
        <NewProjectErrorContent
          error={getErrorMessage(error, 'Unable to load project form.')}
        />
      ) : (
        <>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              Unable to refresh project details. Displayed information may be
              out of date.
            </p>
          ) : null}
          <NewProjectDialogData
            team={context.team}
            servers={context.servers}
            onPendingChange={onPendingChange}
            onCreated={onCreated}
          />
        </>
      )}
    </>
  )
}

function NewProjectErrorContent({ error }: { error: string }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Create project</DialogTitle>
        <DialogDescription>{error}</DialogDescription>
      </DialogHeader>
      <Empty className="min-h-60 border">
        <EmptyHeader>
          <EmptyTitle>Unable to load project form.</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  )
}

function RepositoryStep({
  onRetry,
  error,
  appConfigured,
  filteredRepos,
  installUrl,
  installations,
  isLoading,
  onInstallAccountChange,
  onQueryChange,
  onSelectRepo,
  query,
  selectedInstallation,
  selectedInstallationId,
}: {
  error: string | null
  onRetry: () => void
  appConfigured: boolean
  filteredRepos: Array<Repository>
  installUrl: string
  installations: Array<Installation>
  isLoading: boolean
  onInstallAccountChange: (installationId: number) => void
  onQueryChange: (query: string) => void
  onSelectRepo: (repo: Repository) => void
  query: string
  selectedInstallation: Installation | undefined
  selectedInstallationId: number | null
}) {
  if (!appConfigured) {
    return (
      <Empty className="min-h-60 border">
        <EmptyHeader>
          <EmptyTitle>GitHub App is not configured.</EmptyTitle>
          <EmptyDescription>
            Add the GitHub App environment variables before selecting a
            repository.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (installations.length === 0) {
    return (
      <Empty className="min-h-60 border">
        <EmptyHeader>
          <EmptyTitle>Install the GitHub App.</EmptyTitle>
          <EmptyDescription>
            Install the app on a GitHub account or organization to select
            repositories.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild type="button">
            <a href={installUrl}>
              <GithubIcon data-icon="inline-start" />
              Install GitHub App
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <AccountDropdown
          installations={installations}
          installUrl={installUrl}
          selectedInstallation={selectedInstallation}
          selectedInstallationId={selectedInstallationId}
          onChange={onInstallAccountChange}
        />
        <InputGroup className="h-8 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by name"
            type="search"
            value={query}
          />
        </InputGroup>
      </div>

      <div>
        {isLoading ? (
          <RepositoryListPending />
        ) : error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button type="button" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : filteredRepos.length > 0 ? (
          <ul
            className="overflow-hidden rounded-lg border"
            role="listbox"
            aria-label="Repository list"
            aria-live="polite"
          >
            {filteredRepos.map((repo) => (
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
                  {formatUpdatedAt(repo.updatedAt)}
                </p>
                <Button
                  className="ml-auto"
                  onClick={() => onSelectRepo(repo)}
                  size="xs"
                  type="button"
                >
                  Select
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="min-h-50 border">
            <EmptyHeader>
              <EmptyTitle>No repositories found.</EmptyTitle>
              <EmptyDescription>
                Try a different search or check which repositories the GitHub
                App can access.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}

function AccountDropdown({
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

function ConfigureStep({
  composePath,
  envVars,
  fieldErrors,
  projectName,
  readinessPath,
  releaseCommand,
  releaseService,
  repository,
  selectedServerId,
  servers,
  onAddEnvVar,
  onComposePathChange,
  onEnvVarChange,
  onProjectNameChange,
  onReadinessPathChange,
  onReleaseCommandChange,
  onReleaseServiceChange,
  onRemoveEnvVar,
  onServerChange,
}: {
  composePath: string
  envVars: Array<{ id: string; key: string; value: string }>
  fieldErrors: NewProjectFieldErrors
  projectName: string
  readinessPath: string
  releaseCommand: string
  releaseService: string
  repository: Repository | null
  selectedServerId: string | null
  servers: Array<ServerSummary>
  onAddEnvVar: () => void
  onComposePathChange: (path: string) => void
  onEnvVarChange: (
    id: string,
    update: Partial<{ key: string; value: string }>,
  ) => void
  onProjectNameChange: (name: string) => void
  onReadinessPathChange: (path: string) => void
  onReleaseCommandChange: (command: string) => void
  onReleaseServiceChange: (service: string) => void
  onRemoveEnvVar: (id: string) => void
  onServerChange: (serverId: string | null) => void
}) {
  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-2">
        <Field>
          <FieldLabel>Repository</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <GithubIcon />
            </InputGroupAddon>
            <InputGroupInput disabled value={repository?.fullName ?? ''} />
          </InputGroup>
        </Field>
        <Field className="sm:w-1/3">
          <FieldLabel>Production branch</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <GitBranchIcon />
            </InputGroupAddon>
            <InputGroupInput disabled value={repository?.defaultBranch ?? ''} />
          </InputGroup>
        </Field>
      </div>

      <Field data-invalid={Boolean(fieldErrors.projectName)}>
        <FieldLabel htmlFor="new-project-name">Project name</FieldLabel>
        <Input
          aria-invalid={Boolean(fieldErrors.projectName)}
          id="new-project-name"
          aria-describedby="new-project-name-error"
          maxLength={100}
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder="e.g., my-project"
          required
          value={projectName}
        />
        <FieldError id="new-project-name-error">
          {fieldErrors.projectName}
        </FieldError>
      </Field>

      <Field data-invalid={Boolean(fieldErrors.serverId)}>
        <FieldLabel>Production server</FieldLabel>
        <Select
          value={selectedServerId ?? '__none__'}
          onValueChange={(value) =>
            onServerChange(value === '__none__' ? null : value)
          }
        >
          <SelectTrigger
            id="new-project-server"
            aria-describedby="new-project-server-error"
            className="w-full"
          >
            <SelectValue placeholder="Select a server" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No server</SelectItem>
            {servers.map((server) => (
              <SelectItem key={server.id} value={server.id}>
                <span className="flex items-center gap-x-2">
                  <ServerAvatar name={server.name} status={server.status} />
                  {server.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="new-project-server-error">
          {fieldErrors.serverId}
        </FieldError>
      </Field>

      <div className="grid gap-5 border-t pt-5">
        <Field data-invalid={Boolean(fieldErrors.composePath)}>
          <FieldLabel htmlFor="new-project-compose-path">
            Compose file path
          </FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.composePath)}
            id="new-project-compose-path"
            maxLength={255}
            aria-describedby="new-project-compose-path-error"
            value={composePath}
            placeholder="compose.yml"
            onChange={(event) => onComposePathChange(event.target.value)}
          />
          <FieldError id="new-project-compose-path-error">
            {fieldErrors.composePath}
          </FieldError>
        </Field>
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)]">
          <Field data-invalid={Boolean(fieldErrors.releaseCommand)}>
            <FieldLabel htmlFor="new-project-release-command">
              Pre-deploy command
            </FieldLabel>
            <Textarea
              aria-invalid={Boolean(fieldErrors.releaseCommand)}
              className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
              id="new-project-release-command"
              maxLength={16384}
              aria-describedby="new-project-release-command-error"
              rows={1}
              value={releaseCommand}
              onChange={(event) => onReleaseCommandChange(event.target.value)}
            />
            <FieldDescription>
              Runs once before services are updated. For example,{' '}
              <code>php artisan migrate --force</code>. Leave empty to skip.
            </FieldDescription>
            <FieldError id="new-project-release-command-error">
              {fieldErrors.releaseCommand}
            </FieldError>
          </Field>
          <Field data-invalid={Boolean(fieldErrors.releaseService)}>
            <FieldLabel htmlFor="new-project-release-service">
              Pre-deploy service
            </FieldLabel>
            <Input
              aria-invalid={Boolean(fieldErrors.releaseService)}
              id="new-project-release-service"
              aria-describedby="new-project-release-service-error"
              value={releaseService}
              placeholder="Automatic"
              onChange={(event) => onReleaseServiceChange(event.target.value)}
            />
            <FieldDescription>
              Service to run the pre-deploy command.
            </FieldDescription>
            <FieldError id="new-project-release-service-error">
              {fieldErrors.releaseService}
            </FieldError>
          </Field>
        </div>
        <Field data-invalid={Boolean(fieldErrors.readinessPath)}>
          <FieldLabel htmlFor="new-project-readiness-path">
            Health check path
          </FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.readinessPath)}
            id="new-project-readiness-path"
            aria-describedby="new-project-readiness-path-error"
            value={readinessPath}
            placeholder="/"
            onChange={(event) => onReadinessPathChange(event.target.value)}
          />
          <FieldDescription>
            Path requested after deployment to confirm the service is ready.
          </FieldDescription>
          <FieldError id="new-project-readiness-path-error">
            {fieldErrors.readinessPath}
          </FieldError>
        </Field>
      </div>

      <Field
        className="border-t pt-5"
        data-invalid={Boolean(fieldErrors.envVars)}
      >
        <div>
          <h3 className="text-sm font-medium">Environment variables</h3>
          <p className="text-sm text-muted-foreground">
            Variables for the production environment.
          </p>
        </div>
        {envVars.length > 0 ? (
          <div className="grid gap-2">
            {envVars.map((envVar) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2"
                key={envVar.id}
              >
                <Input
                  className="font-mono text-[13px]"
                  value={envVar.key}
                  placeholder="KEY"
                  onChange={(event) =>
                    onEnvVarChange(envVar.id, { key: event.target.value })
                  }
                />
                <NewProjectEnvVarValueTextarea
                  value={envVar.value}
                  onChange={(value) => onEnvVarChange(envVar.id, { value })}
                />
                <Button
                  aria-label="Remove variable"
                  size="icon"
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onRemoveEnvVar(envVar.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <FieldError>{fieldErrors.envVars}</FieldError>
        <div className="flex">
          <Button type="button" variant="outline" onClick={onAddEnvVar}>
            <PlusIcon data-icon="inline-start" />
            Add variable
          </Button>
        </div>
      </Field>
    </div>
  )
}

function NewProjectEnvVarValueTextarea({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    resizeTextarea(ref.current)
  }, [value])

  return (
    <Textarea
      ref={ref}
      className="min-h-8 resize-none overflow-hidden break-all py-1.5 font-mono text-[13px]"
      placeholder="value"
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
        resizeTextarea(event.currentTarget)
      }}
    />
  )
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return
  }

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function ConnectGitHub({
  onConnect,
  busy,
}: {
  onConnect: () => void
  busy: boolean
}) {
  return (
    <Empty className="min-h-60 border">
      <EmptyHeader>
        <EmptyTitle>Connect your GitHub account.</EmptyTitle>
        <EmptyDescription>
          Connect your GitHub account to search for repositories.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onConnect} disabled={busy} type="button">
          <GithubIcon data-icon="inline-start" />
          Connect account
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function getNewProjectFieldErrors(error: unknown): NewProjectFieldErrors {
  const message = getErrorMessage(error, 'Unable to create project.')

  if (/project names?/i.test(message)) {
    return { projectName: message }
  }

  if (/compose/i.test(message)) {
    return { composePath: message }
  }

  if (/health check/i.test(message)) {
    return { readinessPath: message }
  }

  if (/environment variable/i.test(message)) {
    return { envVars: message }
  }

  if (/server/i.test(message)) {
    return { serverId: message }
  }

  return { form: message }
}

function formatUpdatedAt(value: string) {
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

  return `Updated ${new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year:
      updatedAt.getFullYear() === new Date().getFullYear()
        ? undefined
        : 'numeric',
  }).format(updatedAt)}`
}
