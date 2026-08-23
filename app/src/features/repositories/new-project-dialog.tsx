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
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { authClient } from '@/lib/auth/client'
import { getErrorMessage } from '@/lib/error-message'
import { useVisibleRefresh } from '@/lib/use-visible-refresh'
import {
  createProject,
  getNewProjectContext,
  getRepositorySelectionRepositories,
} from '@/server/projects/functions'
import type { RepositorySelectionContext } from '@/server/projects/service'
import type { ServerSummary, TeamSummary } from '@/server/teams/service'

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
    | 'composePath'
    | 'envVars'
    | 'projectName'
    | 'readinessPath'
    | 'releaseCommand'
    | 'serverId',
    string
  >
>

export function NewProjectDialog({
  team,
  servers,
  repositorySelection,
  onClose,
}: {
  team: TeamSummary
  servers: Array<ServerSummary>
  repositorySelection: RepositorySelectionContext
  onClose?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  function closeDialog() {
    setOpen(false)
    if (onClose) {
      onClose()
      return
    }

    void router.navigate({
      to: '/$teamSlug',
      params: { teamSlug: team.slug },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog()
        }
      }}
    >
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
        <NewProjectDialogContent
          team={team}
          servers={servers}
          repositorySelection={repositorySelection}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewProjectDialogContent({
  team,
  servers,
  repositorySelection,
}: {
  team: TeamSummary
  servers: Array<ServerSummary>
  repositorySelection: RepositorySelectionContext
}) {
  const router = useRouter()
  const github = repositorySelection.github
  const installations = github.connected ? github.installations : []
  const initialInstallationId = installations.at(0)?.id ?? null
  const initialRepositories = github.connected ? github.repositories : []
  const hasInitialRepositories =
    initialInstallationId !== null &&
    initialRepositories.some(
      (repo) => repo.installationId === initialInstallationId,
    )
  const [repositories, setRepositories] =
    useState<Array<Repository>>(initialRepositories)
  const [step, setStep] = useState<'repository' | 'configure'>('repository')
  const [selectedInstallationId, setSelectedInstallationId] = useState<
    number | null
  >(initialInstallationId)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [projectName, setProjectName] = useState('')
  const [serverId, setServerId] = useState<string | null>(
    servers.at(0)?.id ?? null,
  )
  const [composePath, setComposePath] = useState('')
  const [releaseCommand, setReleaseCommand] = useState('')
  const [readinessPath, setReadinessPath] = useState('')
  const [envVars, setEnvVars] = useState<
    Array<{ id: string; key: string; value: string }>
  >([])
  const [fieldErrors, setFieldErrors] = useState<NewProjectFieldErrors>({})
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isDebouncing, setIsDebouncing] = useState(false)
  const [isLoadingRepos, setIsLoadingRepos] = useState(
    github.connected &&
      github.appConfigured &&
      installations.length > 0 &&
      !hasInitialRepositories,
  )
  const [isCreating, setIsCreating] = useState(false)
  const skippedInitialRepositoryFetch = useRef(false)

  useEffect(() => {
    setIsDebouncing(true)
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim().toLowerCase())
      setIsDebouncing(false)
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    if (!github.connected || !github.appConfigured || !selectedInstallationId) {
      return
    }

    if (
      !skippedInitialRepositoryFetch.current &&
      hasInitialRepositories &&
      selectedInstallationId === initialInstallationId
    ) {
      skippedInitialRepositoryFetch.current = true
      setIsLoadingRepos(false)
      return
    }

    skippedInitialRepositoryFetch.current = true
    let cancelled = false

    setRepositories([])
    setIsLoadingRepos(true)

    void getRepositorySelectionRepositories({
      data: {
        teamSlug: team.slug,
        installationId: selectedInstallationId,
      },
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
  }, [
    github.appConfigured,
    github.connected,
    hasInitialRepositories,
    initialInstallationId,
    selectedInstallationId,
    team.slug,
  ])

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

    if (!debouncedQuery) {
      return repos.slice(0, 5)
    }

    return repos
      .filter((repo) => repo.fullName.toLowerCase().includes(debouncedQuery))
      .sort((first, second) => {
        const firstName = first.fullName.toLowerCase()
        const secondName = second.fullName.toLowerCase()

        return (
          Number(!firstName.startsWith(debouncedQuery)) -
            Number(!secondName.startsWith(debouncedQuery)) ||
          firstName.length - secondName.length
        )
      })
      .slice(0, 5)
  }, [debouncedQuery, repositories, selectedInstallationId])

  async function connectGitHub() {
    const result = await authClient.signIn.social({
      provider: 'github',
      callbackURL: `/${team.slug}/new-project`,
    })

    if (result.error) {
      toast.error(getErrorMessage(result.error, 'Unable to connect GitHub.'))
    }
  }

  function getInstallGitHubAppUrl() {
    return `/api/github/install?next=${encodeURIComponent(`/${team.slug}/new-project`)}`
  }

  async function submitProject() {
    if (!selectedRepo) {
      return
    }

    setFieldErrors({})
    setIsCreating(true)

    try {
      const project = await createProject({
        data: {
          teamSlug: team.slug,
          projectName,
          repoFullName: selectedRepo.fullName,
          installationId: selectedRepo.installationId,
          serverId: serverId ?? '',
          composePath,
          envVars: envVars
            .filter((envVar) => envVar.key.trim() || envVar.value)
            .map((envVar) => ({
              key: envVar.key,
              value: envVar.value,
              environment: 'production',
            })),
        },
      })

      await router.navigate({
        to: '/$teamSlug/projects/$projectName',
        params: {
          teamSlug: team.slug,
          projectName: project.name,
        },
      })
    } catch (error) {
      setFieldErrors(getNewProjectFieldErrors(error))
    } finally {
      setIsCreating(false)
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
            isLoading={isDebouncing || isLoadingRepos}
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
            <div className="scrollbar -m-4 min-h-0 overflow-y-auto p-4">
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
                onRemoveEnvVar={(id) =>
                  setEnvVars((current) =>
                    current.filter((envVar) => envVar.id !== id),
                  )
                }
                onServerChange={setServerId}
              />
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setStep('repository')}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
              <Button
                disabled={!selectedRepo || !projectName || isCreating}
                type="button"
                onClick={() => void submitProject()}
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
        <ConnectGitHub onConnect={() => void connectGitHub()} />
      )}
    </>
  )
}

export function NewProjectDialogLauncher({
  children,
  teamSlug,
}: {
  children: (open: () => void) => ReactNode
  teamSlug: string
}) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<Awaited<
    ReturnType<typeof getNewProjectContext>
  > | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadContext() {
    try {
      const nextContext = await getNewProjectContext({ data: { teamSlug } })
      setContext(nextContext)
      setError(
        nextContext ? null : 'You need to sign in before creating a project.',
      )
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load project form.',
      )
    }
  }

  useVisibleRefresh(loadContext, open)

  function openDialog() {
    setContext(null)
    setError(null)
    setOpen(true)

    void loadContext()
  }

  function closeDialog() {
    setOpen(false)
  }

  return (
    <>
      {children(openDialog)}
      {open ? (
        <Dialog open onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
          <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
            {context ? (
              <NewProjectDialogContent
                team={context.team}
                servers={context.servers}
                repositorySelection={context.repositorySelection}
              />
            ) : error ? (
              <NewProjectErrorContent error={error} />
            ) : (
              <NewProjectLoadingContent />
            )}
          </DialogContent>
        </Dialog>
      ) : null}
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

function NewProjectLoadingContent() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Create project</DialogTitle>
        <DialogDescription>
          Select a repository, then confirm the initial deployment defaults.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <RepositoryToolbarSkeleton />
        <RepoListSkeleton />
      </div>
    </>
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

function RepositoryStep({
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
          <RepoListSkeleton />
        ) : filteredRepos.length > 0 ? (
          <ul role="listbox" aria-label="Repository list" aria-live="polite">
            {filteredRepos.map((repo, index) => (
              <li
                className={`flex h-12 items-center gap-2 border px-4 text-sm transition-colors hover:bg-muted/50 ${
                  index > 0 ? 'border-t-0' : 'rounded-t-lg'
                } ${index === filteredRepos.length - 1 ? 'rounded-b-lg' : ''}`}
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
          <p className="flex h-50 items-center justify-center rounded-lg bg-muted px-4 text-sm text-muted-foreground">
            No repositories found
          </p>
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
  repository,
  selectedServerId,
  servers,
  onAddEnvVar,
  onComposePathChange,
  onEnvVarChange,
  onProjectNameChange,
  onReadinessPathChange,
  onReleaseCommandChange,
  onRemoveEnvVar,
  onServerChange,
}: {
  composePath: string
  envVars: Array<{ id: string; key: string; value: string }>
  fieldErrors: NewProjectFieldErrors
  projectName: string
  readinessPath: string
  releaseCommand: string
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
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder="e.g., my-project"
          required
          value={projectName}
        />
        <FieldError>{fieldErrors.projectName}</FieldError>
      </Field>

      <Field data-invalid={Boolean(fieldErrors.serverId)}>
        <FieldLabel>Production server</FieldLabel>
        <Select
          value={selectedServerId ?? '__none__'}
          onValueChange={(value) =>
            onServerChange(value === '__none__' ? null : value)
          }
        >
          <SelectTrigger className="w-full">
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
        <FieldError>{fieldErrors.serverId}</FieldError>
      </Field>

      <div className="grid gap-5 border-t pt-5">
        <Field data-invalid={Boolean(fieldErrors.composePath)}>
          <FieldLabel htmlFor="new-project-compose-path">
            Compose file path
          </FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.composePath)}
            id="new-project-compose-path"
            value={composePath}
            placeholder="compose.yml"
            onChange={(event) => onComposePathChange(event.target.value)}
          />
          <FieldError>{fieldErrors.composePath}</FieldError>
        </Field>
        <Field data-invalid={Boolean(fieldErrors.releaseCommand)}>
          <FieldLabel htmlFor="new-project-release-command">
            Pre-deploy command
          </FieldLabel>
          <Textarea
            aria-invalid={Boolean(fieldErrors.releaseCommand)}
            className="resize-none py-1.5 font-mono"
            id="new-project-release-command"
            value={releaseCommand}
            placeholder="php artisan migrate --force"
            onChange={(event) => onReleaseCommandChange(event.target.value)}
          />
          <FieldDescription>
            Optional command run inside the application service after images are
            ready and before services are updated.
          </FieldDescription>
          <FieldError>{fieldErrors.releaseCommand}</FieldError>
        </Field>
        <Field data-invalid={Boolean(fieldErrors.readinessPath)}>
          <FieldLabel htmlFor="new-project-readiness-path">
            Health check path
          </FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.readinessPath)}
            id="new-project-readiness-path"
            value={readinessPath}
            placeholder="/health"
            onChange={(event) => onReadinessPathChange(event.target.value)}
          />
          <FieldDescription>
            HTTP path Devpush requests after deployment. Defaults to /.
          </FieldDescription>
          <FieldError>{fieldErrors.readinessPath}</FieldError>
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

function ConnectGitHub({ onConnect }: { onConnect: () => void }) {
  return (
    <Empty className="min-h-60 border">
      <EmptyHeader>
        <EmptyTitle>Connect your GitHub account.</EmptyTitle>
        <EmptyDescription>
          Connect your GitHub account to search for repositories.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onConnect} type="button">
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

  if (/environment variable/i.test(message)) {
    return { envVars: message }
  }

  if (/server/i.test(message)) {
    return { serverId: message }
  }

  return { projectName: message }
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
