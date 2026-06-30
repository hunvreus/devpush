import { Link, useParams, useRouter } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  FileTextIcon,
  LoaderIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import type { ClipboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ResourceAvatar } from '@/components/resource-avatar'
import {
  EnvironmentColorOption,
  EnvironmentDot,
  environmentColors,
  getEnvironmentColor,
} from '@/features/projects/environment-dot'
import { ServerAvatar } from '@/features/servers/server-avatar'
import { getErrorMessage } from '@/lib/error-message'
import {
  getNewProjectContext,
  getRepositorySelectionRepositories,
  deleteProjectAction,
  saveProjectEnvironments,
  saveProjectDomains,
  saveProjectEnvVars,
  saveProjectBackupConfigs,
  saveProjectRoutes,
  saveProjectServerAssignments,
  saveProjectSettings,
} from '@/server/projects/functions'
import type {
  ProjectContext,
  ProjectDomain,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
  ProjectBackupConfig,
  ProjectRoute,
  ProjectServerAssignment,
  RepositorySelectionContext,
} from '@/server/projects/service'

export function ProjectSettings({ context }: { context: ProjectContext }) {
  const router = useRouter()
  const params = useParams({ strict: false })
  const { project } = context
  const initialRoutes = context.routes
  const initialDomains = context.domains.map(mapProjectDomainAlias)
  const [projectName, setProjectName] = useState(project.name)
  const [selectedRepo, setSelectedRepo] = useState<ProjectRepository>({
    fullName: project.githubRepo,
    id: project.githubRepoId,
    installationId: project.githubInstallationId,
  })
  const [savedRepo, setSavedRepo] = useState<ProjectRepository>({
    fullName: project.githubRepo,
    id: project.githubRepoId,
    installationId: project.githubInstallationId,
  })
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(project.avatarUrl)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [deleteAvatar, setDeleteAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [composePath, setComposePath] = useState(
    project.composePath ?? 'compose.yml',
  )
  const [releaseCommand, setReleaseCommand] = useState(
    project.releaseCommand ?? '',
  )
  const [readinessPath, setReadinessPath] = useState(
    project.readinessPath ?? '',
  )
  const [routes, setRoutes] =
    useState<Array<ProjectRouteDefinition>>(initialRoutes)
  const [domains, setDomains] =
    useState<Array<ProjectDomainAlias>>(initialDomains)
  const [savedRoutes, setSavedRoutes] =
    useState<Array<ProjectRouteDefinition>>(initialRoutes)
  const [savedDomains, setSavedDomains] =
    useState<Array<ProjectDomainAlias>>(initialDomains)
  const [savedSettings, setSavedSettings] = useState({
    projectName: project.name,
    composePath: project.composePath ?? 'compose.yml',
    releaseCommand: project.releaseCommand ?? '',
    readinessPath: project.readinessPath ?? '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isDeletingProject, setIsDeletingProject] = useState(false)
  const [deleteProjectConfirmation, setDeleteProjectConfirmation] = useState('')
  const [removeProjectDeployments, setRemoveProjectDeployments] = useState(true)
  const hasSettingsChanges =
    projectName !== savedSettings.projectName ||
    selectedRepo.fullName !== savedRepo.fullName ||
    selectedRepo.installationId !== savedRepo.installationId ||
    Boolean(avatarDataUrl) ||
    deleteAvatar ||
    composePath !== savedSettings.composePath ||
    releaseCommand !== savedSettings.releaseCommand ||
    readinessPath !== savedSettings.readinessPath
  const hasRouteChanges = JSON.stringify(routes) !== JSON.stringify(savedRoutes)
  const hasDomainChanges =
    JSON.stringify(domains) !== JSON.stringify(savedDomains)

  function resetSettings() {
    setProjectName(savedSettings.projectName)
    setSelectedRepo(savedRepo)
    setAvatarDataUrl(null)
    setDeleteAvatar(false)
    setComposePath(savedSettings.composePath)
    setReleaseCommand(savedSettings.releaseCommand)
    setReadinessPath(savedSettings.readinessPath)
  }

  function resetRoutes() {
    setRoutes(savedRoutes)
  }

  function resetDomains() {
    setDomains(savedDomains)
  }

  async function saveSettings({
    onSuccess,
    message = 'Project settings saved.',
    includeGeneralChanges = false,
  }: {
    onSuccess?: (nextContext: ProjectContext) => void
    message?: string
    includeGeneralChanges?: boolean
  } = {}) {
    setIsSaving(true)

    try {
      const settings = includeGeneralChanges
        ? { projectName, composePath, releaseCommand, readinessPath }
        : savedSettings
      const repo = includeGeneralChanges ? selectedRepo : savedRepo

      const nextContext = await saveProjectSettings({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          currentProjectName: project.name,
          projectName: settings.projectName,
          repoFullName: repo.fullName,
          installationId: repo.installationId,
          avatarDataUrl: includeGeneralChanges ? avatarDataUrl : null,
          deleteAvatar: includeGeneralChanges ? deleteAvatar : false,
          composePath: settings.composePath,
          releaseCommand: settings.releaseCommand.trim() || null,
          readinessPath: settings.readinessPath.trim() || null,
        },
      })
      onSuccess?.(nextContext)
      toast.success(message)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save settings.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function saveProjectFields() {
    await saveSettings({
      includeGeneralChanges: true,
      onSuccess: (nextContext) => {
        setSavedSettings({
          projectName: nextContext.project.name,
          composePath: nextContext.project.composePath ?? 'compose.yml',
          releaseCommand: nextContext.project.releaseCommand ?? '',
          readinessPath: nextContext.project.readinessPath ?? '',
        })
        setProjectName(nextContext.project.name)
        setComposePath(nextContext.project.composePath ?? 'compose.yml')
        setReleaseCommand(nextContext.project.releaseCommand ?? '')
        setReadinessPath(nextContext.project.readinessPath ?? '')
        setSavedRepo(selectedRepo)
        setSavedAvatarUrl(nextContext.project.avatarUrl)
        setAvatarDataUrl(null)
        setDeleteAvatar(false)
        if (nextContext.project.name !== project.name) {
          void router.navigate({
            to: '/$teamSlug/projects/$projectName/settings',
            params: {
              teamSlug: nextContext.team.slug,
              projectName: nextContext.project.name,
            },
          })
        }
      },
    })
  }

  async function deleteCurrentProject() {
    const teamSlug = typeof params.teamSlug === 'string' ? params.teamSlug : ''
    setIsDeletingProject(true)

    try {
      await deleteProjectAction({
        data: {
          teamSlug,
          projectName: project.name,
          confirmationName: deleteProjectConfirmation,
          removeDeployments: removeProjectDeployments,
        },
      })
      toast.success('Project deleted.')
      await router.navigate({
        to: '/$teamSlug/projects',
        params: { teamSlug },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete project.'))
    } finally {
      setIsDeletingProject(false)
    }
  }

  async function chooseAvatar(file: File | undefined) {
    if (!file) {
      return
    }

    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
        file.type,
      )
    ) {
      toast.error('Upload a PNG, JPEG, GIF, or WebP image.')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Project avatars must be 2 MB or smaller.')
      return
    }

    setAvatarDataUrl(await readFileAsDataUrl(file))
    setDeleteAvatar(false)
  }

  const avatarUrl = deleteAvatar
    ? undefined
    : (avatarDataUrl ?? savedAvatarUrl ?? undefined)
  const selectedRepoOwner =
    selectedRepo.fullName.split('/')[0] ?? selectedRepo.fullName

  async function saveRoutes() {
    setIsSaving(true)

    try {
      const nextContext = await saveProjectRoutes({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: project.name,
          routes,
        },
      })
      const aliases = nextContext.domains.map(mapProjectDomainAlias)
      setSavedRoutes(nextContext.routes)
      setRoutes(nextContext.routes)
      setSavedDomains(aliases)
      setDomains(aliases)
      toast.success('Routes saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save routes.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function saveDomains() {
    const nextDomains = normalizeDomainsForRoutes(domains, savedRoutes)

    setIsSaving(true)

    try {
      const nextContext = await saveProjectDomains({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: project.name,
          domains: nextDomains.map((domain) => ({
            host: domain.host,
            environmentId: domain.environment,
            basePath: domain.baseRoute,
            https: domain.https,
          })),
        },
      })
      const aliases = nextContext.domains.map(mapProjectDomainAlias)
      setSavedDomains(aliases)
      setDomains(aliases)
      toast.success('Domains saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save domains.'))
    } finally {
      setIsSaving(false)
    }
  }

  function mapProjectDomainAlias(domain: ProjectDomain): ProjectDomainAlias {
    return {
      generated: domain.generated,
      id: domain.id,
      host: domain.host,
      environment: domain.environmentId,
      baseRoute: domain.basePath ?? '',
      https: domain.https,
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
      <div className="space-y-8">
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <Link
            to="/$teamSlug/projects/$projectName"
            params={{
              teamSlug:
                typeof params.teamSlug === 'string' ? params.teamSlug : '',
              projectName: project.name,
            }}
            className="shrink-0"
          >
            <ResourceAvatar
              name={project.name}
              src={avatarUrl}
              color={project.color}
              size="md"
            />
          </Link>
          <span className="font-normal text-muted-foreground/25">/</span>
          <span>Project settings</span>
        </h1>

        <SettingsSection
          id="general"
          title="General"
          description="General settings for the project including the Git repository."
          footer={
            <SettingsActions
              hasChanges={hasSettingsChanges}
              isSaving={isSaving}
              onCancel={resetSettings}
              onSave={saveProjectFields}
            />
          }
        >
          <div className="space-y-8">
            <div className="space-y-3">
              <Label>Avatar</Label>
              <div className="flex items-center gap-x-2">
                <ResourceAvatar
                  name={project.name}
                  src={avatarUrl}
                  color={project.color}
                  size="md"
                />
                <input
                  ref={avatarInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(event) =>
                    void chooseAvatar(event.target.files?.[0])
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <UploadIcon />
                  Upload image
                </Button>
                {avatarUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setAvatarDataUrl(null)
                      setDeleteAvatar(true)
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </div>
            <div className="space-y-3">
              <Label>Git repository</Label>
              <div className="flex items-center">
                <RepositoryPickerDialog
                  teamSlug={
                    typeof params.teamSlug === 'string' ? params.teamSlug : ''
                  }
                  currentRepo={selectedRepo}
                  onSelect={setSelectedRepo}
                >
                  <Button
                    variant="outline"
                    type="button"
                    className="rounded-r-none border-r-0 px-3 font-normal"
                  >
                    <img
                      src={`https://github.com/${selectedRepoOwner}.png`}
                      alt=""
                      className="size-5 rounded"
                    />
                    {selectedRepo.fullName}
                    <ChevronsUpDownIcon className="text-muted-foreground group-hover/button:text-muted-foreground" />
                  </Button>
                </RepositoryPickerDialog>
                <IconActionTooltip label="View on GitHub">
                  <Button
                    variant="outline"
                    size="icon"
                    className="rounded-l-none text-muted-foreground hover:text-foreground"
                    asChild
                  >
                    <a
                      href={`https://github.com/${selectedRepo.fullName}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View on GitHub"
                    >
                      <ArrowUpRightIcon />
                    </a>
                  </Button>
                </IconActionTooltip>
              </div>
            </div>
            <div className="space-y-3">
              <Label htmlFor="project-id">Project ID</Label>
              <InputGroup>
                <InputGroupInput
                  id="project-id"
                  className="font-mono text-[13px] text-muted-foreground"
                  value={project.id}
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <IconActionTooltip label="Copy project ID">
                    <InputGroupButton
                      size="icon-sm"
                      type="button"
                      aria-label="Copy project ID"
                      onClick={() =>
                        void navigator.clipboard.writeText(project.id)
                      }
                    >
                      <CopyIcon />
                    </InputGroupButton>
                  </IconActionTooltip>
                </InputGroupAddon>
              </InputGroup>
              <p className="text-sm text-muted-foreground">
                A unique identifier used in API, environment variables, etc.
              </p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          id="build-and-deploy"
          title="Build and Deploy"
          description="Configuration for deploying the Compose project: compose file, release command, readiness check, etc."
          footer={
            <SettingsActions
              hasChanges={hasSettingsChanges}
              isSaving={isSaving}
              onCancel={resetSettings}
              onSave={saveProjectFields}
            />
          }
        >
          <div className="grid gap-5">
            <div className="space-y-2">
              <Label htmlFor="compose-path">Compose file path</Label>
              <Input
                id="compose-path"
                value={composePath}
                onChange={(event) => setComposePath(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-command">Release command</Label>
              <Input
                id="release-command"
                value={releaseCommand}
                placeholder="php artisan migrate --force"
                onChange={(event) => setReleaseCommand(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="readiness">Readiness path</Label>
              <Input
                id="readiness"
                value={readinessPath}
                placeholder="/health"
                onChange={(event) => setReadinessPath(event.target.value)}
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          id="environments"
          title="Environments"
          description="Deployments will be associated with the first environment with a matching branch pattern."
        >
          <EnvironmentSettingsTable context={context} />
        </SettingsSection>

        <SettingsSection
          id="environment-variables"
          title="Environment variables"
          description="Variables available at build time and runtime. Changes will take effect after a new deployment."
        >
          <EnvironmentVariablesSettingsTable context={context} />
        </SettingsSection>

        <SettingsSection
          id="servers"
          title="Servers"
          description="Server assignments for this project's environments."
        >
          <ServerAssignmentSettingsTable context={context} />
        </SettingsSection>

        <SettingsSection
          id="routes"
          title="Routes"
          description="Routes map project paths to Compose services and internal ports."
          footer={
            <SettingsActions
              hasChanges={hasRouteChanges}
              isSaving={isSaving}
              onCancel={resetRoutes}
              onSave={saveRoutes}
            />
          }
        >
          <RouteSettingsTable routes={routes} onChange={setRoutes} />
        </SettingsSection>

        <SettingsSection
          id="domains"
          title="Domains"
          description="Custom domain names associated with this project's environments."
          footer={
            <SettingsActions
              hasChanges={hasDomainChanges}
              isSaving={isSaving}
              onCancel={resetDomains}
              onSave={saveDomains}
            />
          }
        >
          <DomainSettingsTable
            domains={domains}
            environments={context.environments}
            routes={savedRoutes}
            onChange={setDomains}
          />
        </SettingsSection>

        <SettingsSection
          id="backups"
          title="Backups"
          description="Backup configuration for project environments, including storage destination, retention, and database dumps."
        >
          <BackupSettingsTable context={context} />
        </SettingsSection>

        <SettingsSection
          id="danger"
          title="Danger"
          description="Permanently delete the project and all of its configuration, environments and deployments."
        >
          {context.team.role === 'owner' || context.team.role === 'admin' ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={isDeletingProject}
                  onClick={() => {
                    setDeleteProjectConfirmation('')
                    setRemoveProjectDeployments(true)
                  }}
                >
                  {isDeletingProject ? (
                    <LoaderIcon className="animate-spin" />
                  ) : (
                    <Trash2Icon />
                  )}
                  Delete project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the project, its environments,
                    routes, domains, variables, backups, and deployments. This
                    cannot be undone. {`Type "${project.name}" to confirm.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid gap-2">
                  <label
                    htmlFor="delete-project-remove-deployments"
                    className="flex items-start gap-2 rounded-md border p-3 text-sm"
                  >
                    <Checkbox
                      id="delete-project-remove-deployments"
                      checked={removeProjectDeployments}
                      onCheckedChange={(checked) =>
                        setRemoveProjectDeployments(checked === true)
                      }
                    />
                    <span className="grid gap-1">
                      <span className="font-medium">
                        Remove deployed Docker Compose runtimes
                      </span>
                      <span className="text-muted-foreground">
                        Persistent volumes are retained for 7 days. If
                        unchecked, deployments may keep running on connected
                        servers, but devpush will stop managing them.
                      </span>
                    </span>
                  </label>
                  <Input
                    aria-label={`Type ${project.name} to confirm`}
                    id="delete-project-confirmation"
                    placeholder={project.name}
                    value={deleteProjectConfirmation}
                    onChange={(event) =>
                      setDeleteProjectConfirmation(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !isDeletingProject &&
                        deleteProjectConfirmation === project.name
                      ) {
                        event.preventDefault()
                        void deleteCurrentProject()
                      }
                    }}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingProject}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={
                      isDeletingProject ||
                      deleteProjectConfirmation !== project.name
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      void deleteCurrentProject()
                    }}
                  >
                    {isDeletingProject ? (
                      <LoaderIcon className="animate-spin" />
                    ) : null}
                    Delete project
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only team owners and admins can delete projects.
            </p>
          )}
        </SettingsSection>
      </div>

      <aside className="hidden pt-16 text-sm lg:block">
        <nav className="sticky top-[122px] flex flex-col gap-y-1">
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#general">General</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#build-and-deploy">Build and Deploy</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#environments">Environments</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#environment-variables">Environment variables</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#servers">Servers</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#routes">Routes</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#domains">Domains</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#backups">Backups</a>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <a href="#danger">Danger</a>
          </Button>
        </nav>
      </aside>
    </div>
  )
}

type ProjectRouteDefinition = ProjectRoute

type ProjectDomainAlias = {
  generated: boolean
  id: string
  host: string
  environment: string
  baseRoute: string
  https: boolean
}

type ProjectRepository = {
  fullName: string
  id: number | null
  installationId: number | null
}

type Repository = Extract<
  RepositorySelectionContext['github'],
  { connected: true }
>['repositories'][number]

function RepositoryPickerDialog({
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
    .slice(0, 8)

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select repository</DialogTitle>
          <DialogDescription>
            Choose the GitHub repository connected to this project.
          </DialogDescription>
        </DialogHeader>

        {isLoadingContext ? (
          <p className="text-sm text-muted-foreground">
            Loading repositories...
          </p>
        ) : github?.connected ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Select
                value={selectedInstallationId?.toString() ?? ''}
                onValueChange={(value) =>
                  setSelectedInstallationId(Number(value))
                }
              >
                <SelectTrigger size="sm" className="w-auto min-w-40">
                  <SelectValue placeholder="GitHub account" />
                </SelectTrigger>
                <SelectContent>
                  {installations.map((installation) => (
                    <SelectItem
                      key={installation.id}
                      value={installation.id.toString()}
                    >
                      <span className="flex items-center gap-2">
                        <img
                          src={`https://github.com/${installation.accountLogin}.png`}
                          alt=""
                          className="size-5 rounded"
                        />
                        {installation.accountLogin}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            <div className="min-h-60">
              {isLoadingRepos ? (
                <p className="flex h-60 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  Loading repositories...
                </p>
              ) : filteredRepositories.length > 0 ? (
                <ul aria-label="Repository list">
                  {filteredRepositories.map((repo, index) => (
                    <li
                      className={`flex h-12 items-center gap-2 border px-4 text-sm ${
                        index > 0 ? 'border-t-0' : 'rounded-t-lg'
                      } ${
                        index === filteredRepositories.length - 1
                          ? 'rounded-b-lg'
                          : ''
                      }`}
                      key={`${repo.installationId}:${repo.id}`}
                    >
                      <span className="truncate font-medium">
                        {repo.fullName}
                      </span>
                      {repo.private ? (
                        <LockIcon className="size-4 shrink-0 text-muted-foreground" />
                      ) : null}
                      {repo.fullName === currentRepo.fullName ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <Button
                          className="ml-auto"
                          variant="outline"
                          size="sm"
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
                <p className="flex h-60 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  No repositories found
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
            Connect GitHub before selecting a repository.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Unable to read image file.'))
      }
    }
    reader.onerror = () => reject(new Error('Unable to read image file.'))
    reader.readAsDataURL(file)
  })
}

function RouteSettingsTable({
  routes,
  onChange,
}: {
  routes: Array<ProjectRouteDefinition>
  onChange: (routes: Array<ProjectRouteDefinition>) => void
}) {
  function updateRoute(index: number, next: Partial<ProjectRouteDefinition>) {
    onChange(
      routes.map((route, routeIndex) =>
        routeIndex === index ? { ...route, ...next } : route,
      ),
    )
  }

  function addRoute() {
    onChange([
      ...routes,
      { path: '/', service: 'web', port: 3000, stripPrefix: false },
    ])
  }

  function removeRoute(index: number) {
    onChange(routes.filter((_, routeIndex) => routeIndex !== index))
  }

  return (
    <div className="space-y-4">
      {routes.length > 0 ? (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_minmax(96px,0.4fr)_7rem_2rem] gap-x-2 border-b pb-2 text-sm font-medium">
            <div>Path</div>
            <div />
            <div>Service</div>
            <div>Port</div>
            <div>Strip</div>
            <div />
          </div>
          {routes.map((route, index) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_minmax(96px,0.4fr)_7rem_2rem] items-center gap-x-2 border-b py-2"
              key={index}
            >
              <Input
                value={route.path}
                onChange={(event) =>
                  updateRoute(index, { path: event.target.value })
                }
                placeholder="/"
              />
              <ArrowRightIcon className="mx-auto size-4 text-muted-foreground" />
              <Input
                value={route.service}
                onChange={(event) =>
                  updateRoute(index, { service: event.target.value })
                }
                placeholder="web"
              />
              <Input
                type="number"
                min={1}
                max={65535}
                value={route.port}
                onChange={(event) =>
                  updateRoute(index, { port: Number(event.target.value) })
                }
                placeholder="3000"
              />
              <div className="flex h-9 items-center gap-2">
                <Switch
                  aria-label="Strip route prefix"
                  checked={route.stripPrefix}
                  onCheckedChange={(checked) =>
                    updateRoute(index, { stripPrefix: checked })
                  }
                />
              </div>
              <IconActionTooltip label="Remove route">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label="Remove route"
                  onClick={() => removeRoute(index)}
                >
                  <Trash2Icon />
                </Button>
              </IconActionTooltip>
            </div>
          ))}
        </div>
      ) : null}
      <Button variant="outline" size="sm" type="button" onClick={addRoute}>
        <PlusIcon />
        Add route
      </Button>
    </div>
  )
}

function DomainSettingsTable({
  domains,
  environments,
  routes,
  onChange,
}: {
  domains: Array<ProjectDomainAlias>
  environments: Array<ProjectEnvironmentConfig>
  routes: Array<ProjectRouteDefinition>
  onChange: (domains: Array<ProjectDomainAlias>) => void
}) {
  const editableDomains = domains.filter((domain) => !domain.generated)

  function updateDomain(id: string, next: Partial<ProjectDomainAlias>) {
    onChange(
      domains.map((domain) =>
        domain.id === id ? { ...domain, ...next } : domain,
      ),
    )
  }

  function addDomain() {
    onChange([
      ...domains,
      {
        generated: false,
        id: crypto.randomUUID(),
        host: '',
        environment: environments.at(0)?.id ?? 'production',
        baseRoute: '',
        https: true,
      },
    ])
  }

  function removeDomain(id: string) {
    onChange(domains.filter((domain) => domain.id !== id))
  }

  return (
    <div className="space-y-4">
      {editableDomains.length > 0 ? (
        <div>
          <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_4rem_2rem] gap-x-2 border-b pb-2 text-sm font-medium">
            <div>Host</div>
            <div>Environment</div>
            <div>Base route</div>
            <div>HTTPS</div>
            <div />
          </div>
          {editableDomains.map((domain) => (
            <div
              className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_4rem_2rem] items-start gap-x-2 border-b py-2"
              key={domain.id}
            >
              <Input
                value={domain.host}
                onChange={(event) =>
                  updateDomain(domain.id, { host: event.target.value })
                }
                placeholder="myapp.com"
              />
              <Select
                value={domain.environment}
                onValueChange={(value) =>
                  updateDomain(domain.id, { environment: value })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((environment) => (
                    <SelectItem value={environment.id} key={environment.id}>
                      <EnvironmentOptionLabel
                        color={environment.color}
                        label={environment.name}
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={domain.baseRoute || 'all'}
                onValueChange={(value) =>
                  updateDomain(domain.id, {
                    baseRoute: value === 'all' ? '' : value,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All routes</SelectItem>
                  {routes.map((route) => (
                    <SelectItem value={route.path} key={route.path}>
                      {route.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex h-9 items-center justify-center">
                <Switch
                  aria-label="HTTPS"
                  checked={domain.https}
                  onCheckedChange={(checked) =>
                    updateDomain(domain.id, { https: checked })
                  }
                />
              </div>
              <IconActionTooltip label="Remove domain">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label="Remove domain"
                  onClick={() => removeDomain(domain.id)}
                >
                  <Trash2Icon />
                </Button>
              </IconActionTooltip>
            </div>
          ))}
        </div>
      ) : null}
      <Button variant="outline" size="sm" type="button" onClick={addDomain}>
        <PlusIcon />
        Add domain
      </Button>
    </div>
  )
}

function EnvironmentSettingsTable({ context }: { context: ProjectContext }) {
  const params = useParams({ strict: false })
  const [items, setItems] = useState(context.environments)
  const [savedItems, setSavedItems] = useState(context.environments)
  const [isSaving, setIsSaving] = useState(false)
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  function update(
    id: string,
    patch: Partial<
      Pick<ProjectEnvironmentConfig, 'branch' | 'color' | 'name' | 'slug'>
    >,
  ) {
    setItems((current) =>
      current.map((environment) =>
        environment.id === id ? { ...environment, ...patch } : environment,
      ),
    )
  }

  function add() {
    const id = crypto.randomUUID()

    setItems((current) => [
      ...current,
      {
        id,
        name: '',
        slug: '',
        branch: '',
        color: getEnvironmentColor(current.length + 1),
        status: 'active',
      },
    ])
  }

  function remove(environment: ProjectEnvironmentConfig) {
    if (environment.slug === 'production') {
      return
    }

    setItems((current) => current.filter((item) => item.id !== environment.id))
  }

  async function save() {
    setIsSaving(true)

    try {
      await saveProjectEnvironments({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          environments: items,
        },
      })
      setSavedItems(items)
      toast.success('Environments saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save environments.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
        <span className="w-6" />
        <span>Name</span>
        <span>Identifier</span>
        <span>Branch</span>
        <span />
      </div>
      {items.map((environment) => (
        <div
          className="grid min-h-12 grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_2rem] items-center gap-x-2 border-b py-2 text-sm"
          key={environment.id}
        >
          <ColorSelect
            value={environment.color}
            onChange={(color) => update(environment.id, { color })}
          />
          <Input
            value={environment.name}
            placeholder="Production"
            onChange={(event) =>
              update(environment.id, { name: event.target.value })
            }
          />
          <Input
            value={environment.slug}
            placeholder="production"
            readOnly={environment.slug === 'production'}
            onChange={(event) =>
              update(environment.id, { slug: event.target.value })
            }
          />
          <Input
            value={environment.branch}
            placeholder="main"
            onChange={(event) =>
              update(environment.id, { branch: event.target.value })
            }
          />
          <div className="flex items-center justify-end">
            <IconActionTooltip label="Delete environment">
              <Button
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => remove(environment)}
                disabled={isSaving || environment.slug === 'production'}
                aria-label="Delete environment"
              >
                <Trash2Icon />
              </Button>
            </IconActionTooltip>
          </div>
        </div>
      ))}
      <Button
        className="mt-3"
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={isSaving}
      >
        <PlusIcon />
        Add environment
      </Button>
      <div className="mt-6 flex justify-end gap-x-2">
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      </div>
    </div>
  )
}

function ServerAssignmentSettingsTable({
  context,
}: {
  context: ProjectContext
}) {
  const params = useParams({ strict: false })
  const [items, setItems] = useState(context.serverAssignments)
  const [savedItems, setSavedItems] = useState(context.serverAssignments)
  const [isSaving, setIsSaving] = useState(false)
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  function add() {
    setItems((current) => [
      ...current,
      {
        environment: context.environments.at(0)?.id ?? '',
        serverId: context.servers.at(0)?.id ?? '',
      },
    ])
  }

  function update(index: number, patch: Partial<ProjectServerAssignment>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
  }

  function remove(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  async function save() {
    setIsSaving(true)

    try {
      await saveProjectServerAssignments({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          serverAssignments: items,
        },
      })
      setSavedItems(items)
      toast.success('Servers saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save servers.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-x-2 border-b pb-3 text-sm font-medium">
        <span>Environment</span>
        <span>Server</span>
        <span />
      </div>
      {items.map((assignment, index) => (
        <div
          className="grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-x-2 border-b py-2 text-sm"
          key={`server-assignment:${index}`}
        >
          <Select
            value={assignment.environment || '__all__'}
            onValueChange={(environment) =>
              update(index, {
                environment: environment === '__all__' ? '' : environment,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All environments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                <EnvironmentOptionLabel label="All environments" />
              </SelectItem>
              {context.environments.map((environment) => (
                <SelectItem
                  key={environment.id}
                  value={environment.id}
                  textValue={environment.name}
                >
                  <EnvironmentOptionLabel
                    color={environment.color}
                    label={environment.name}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={assignment.serverId}
            onValueChange={(serverId) => update(index, { serverId })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a server" />
            </SelectTrigger>
            <SelectContent>
              {context.servers.map((server) => (
                <SelectItem key={server.id} value={server.id}>
                  <span className="flex items-center gap-x-2">
                    <ServerAvatar name={server.name} status={server.status} />
                    {server.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-end">
            <IconActionTooltip label="Delete server assignment">
              <Button
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => remove(index)}
                disabled={isSaving}
                aria-label="Delete server assignment"
              >
                <Trash2Icon />
              </Button>
            </IconActionTooltip>
          </div>
        </div>
      ))}
      <Button
        className="mt-3"
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={isSaving || context.servers.length === 0}
      >
        <PlusIcon />
        Add server
      </Button>
      <div className="mt-6 flex justify-end gap-x-2">
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      </div>
    </div>
  )
}

function BackupSettingsTable({ context }: { context: ProjectContext }) {
  const params = useParams({ strict: false })
  const [items, setItems] = useState(context.backupConfigs)
  const [savedItems, setSavedItems] = useState(context.backupConfigs)
  const [isSaving, setIsSaving] = useState(false)
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  function add() {
    const usedEnvironmentIds = new Set(items.map((item) => item.environmentId))
    const environment =
      context.environments.find(
        (candidate) => !usedEnvironmentIds.has(candidate.id),
      ) ?? context.environments[0]

    setItems((current) => [
      ...current,
      {
        environmentId: environment.id,
        enabled: true,
        destination: {
          bucket: '',
          prefix: `projects/${context.project.id}/environments/${environment.id}`,
        },
        retention: {
          daily: 7,
          weekly: 4,
          monthly: 3,
        },
        databaseDumps: [],
      },
    ])
  }

  function update(index: number, patch: Partial<ProjectBackupConfig>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
  }

  function updateDestination(
    index: number,
    patch: Partial<ProjectBackupConfig['destination']>,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, destination: { ...item.destination, ...patch } }
          : item,
      ),
    )
  }

  function updateRetention(
    index: number,
    patch: Partial<ProjectBackupConfig['retention']>,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, retention: { ...item.retention, ...patch } }
          : item,
      ),
    )
  }

  function addDump(index: number) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              databaseDumps: [
                ...item.databaseDumps,
                {
                  service: '',
                  command: '',
                  output: 'databases/service.sql.zst',
                },
              ],
            }
          : item,
      ),
    )
  }

  function updateDump(
    configIndex: number,
    dumpIndex: number,
    patch: Partial<ProjectBackupConfig['databaseDumps'][number]>,
  ) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === configIndex
          ? {
              ...item,
              databaseDumps: item.databaseDumps.map((dump, index) =>
                index === dumpIndex ? { ...dump, ...patch } : dump,
              ),
            }
          : item,
      ),
    )
  }

  function removeDump(configIndex: number, dumpIndex: number) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === configIndex
          ? {
              ...item,
              databaseDumps: item.databaseDumps.filter(
                (_, index) => index !== dumpIndex,
              ),
            }
          : item,
      ),
    )
  }

  async function save() {
    setIsSaving(true)

    try {
      const nextContext = await saveProjectBackupConfigs({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          backupConfigs: items.map((item) => ({
            ...item,
            destination: {
              bucket: item.destination.bucket,
              ...(item.destination.region?.trim()
                ? { region: item.destination.region.trim() }
                : {}),
              ...(item.destination.endpoint?.trim()
                ? { endpoint: item.destination.endpoint.trim() }
                : {}),
              ...(item.destination.prefix?.trim()
                ? { prefix: item.destination.prefix.trim() }
                : {}),
            },
          })),
        },
      })
      setItems(nextContext.backupConfigs)
      setSavedItems(nextContext.backupConfigs)
      toast.success('Backup settings saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save backups.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      {items.length > 0 ? (
        <div className="space-y-4">
          {items.map((backupConfig, index) => (
            <div
              key={`backup:${backupConfig.environmentId}:${index}`}
              className="space-y-4 border-b pb-4 last:border-b-0 last:pb-0"
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_2rem]">
                <Select
                  value={backupConfig.environmentId}
                  onValueChange={(environmentId) =>
                    update(index, { environmentId })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {context.environments.map((environment) => (
                      <SelectItem
                        key={environment.id}
                        value={environment.id}
                        textValue={environment.name}
                      >
                        <EnvironmentOptionLabel
                          color={environment.color}
                          label={environment.name}
                        />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex h-9 items-center gap-x-2">
                  <Switch
                    checked={backupConfig.enabled}
                    onCheckedChange={(enabled) => update(index, { enabled })}
                    aria-label="Enable backups"
                  />
                </div>
                <IconActionTooltip label="Delete backup configuration">
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    disabled={isSaving}
                    aria-label="Delete backup configuration"
                  >
                    <Trash2Icon />
                  </Button>
                </IconActionTooltip>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Bucket</Label>
                  <Input
                    value={backupConfig.destination.bucket}
                    placeholder="devpush-backups"
                    onChange={(event) =>
                      updateDestination(index, { bucket: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Prefix</Label>
                  <Input
                    value={backupConfig.destination.prefix ?? ''}
                    placeholder="projects/app/production"
                    onChange={(event) =>
                      updateDestination(index, { prefix: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Region</Label>
                  <Input
                    value={backupConfig.destination.region ?? ''}
                    placeholder="us-east-1"
                    onChange={(event) =>
                      updateDestination(index, { region: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Endpoint</Label>
                  <Input
                    value={backupConfig.destination.endpoint ?? ''}
                    placeholder="https://s3.amazonaws.com"
                    onChange={(event) =>
                      updateDestination(index, { endpoint: event.target.value })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Daily</Label>
                  <Input
                    type="number"
                    min={0}
                    value={backupConfig.retention.daily}
                    onChange={(event) =>
                      updateRetention(index, {
                        daily: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Weekly</Label>
                  <Input
                    type="number"
                    min={0}
                    value={backupConfig.retention.weekly}
                    onChange={(event) =>
                      updateRetention(index, {
                        weekly: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Monthly</Label>
                  <Input
                    type="number"
                    min={0}
                    value={backupConfig.retention.monthly}
                    onChange={(event) =>
                      updateRetention(index, {
                        monthly: Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>

              {backupConfig.databaseDumps.length > 0 ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)_2rem] gap-x-2 border-b pb-2 text-sm font-medium">
                    <span>Service</span>
                    <span>Command</span>
                    <span>Output</span>
                    <span />
                  </div>
                  {backupConfig.databaseDumps.map((dump, dumpIndex) => (
                    <div
                      key={`backup-dump:${index}:${dumpIndex}`}
                      className="grid min-h-12 grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)_2rem] items-start gap-x-2 border-b py-2"
                    >
                      <Input
                        value={dump.service}
                        placeholder="postgres"
                        onChange={(event) =>
                          updateDump(index, dumpIndex, {
                            service: event.target.value,
                          })
                        }
                      />
                      <Input
                        value={dump.command}
                        placeholder='pg_dumpall -U "$POSTGRES_USER"'
                        onChange={(event) =>
                          updateDump(index, dumpIndex, {
                            command: event.target.value,
                          })
                        }
                      />
                      <Input
                        value={dump.output}
                        placeholder="databases/postgres.sql.zst"
                        onChange={(event) =>
                          updateDump(index, dumpIndex, {
                            output: event.target.value,
                          })
                        }
                      />
                      <IconActionTooltip label="Delete database dump">
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          onClick={() => removeDump(index, dumpIndex)}
                          disabled={isSaving}
                          aria-label="Delete database dump"
                        >
                          <Trash2Icon />
                        </Button>
                      </IconActionTooltip>
                    </div>
                  ))}
                </div>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addDump(index)}
                disabled={isSaving}
              >
                <PlusIcon />
                Add database dump
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <Button
        className={items.length > 0 ? 'mt-4' : ''}
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={isSaving || context.environments.length === 0}
      >
        <PlusIcon />
        Add backup
      </Button>
      <div className="mt-6 flex justify-end gap-x-2">
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      </div>
    </div>
  )
}

function EnvironmentVariablesSettingsTable({
  context,
}: {
  context: ProjectContext
}) {
  const params = useParams({ strict: false })
  const [items, setItems] = useState(context.envVars)
  const [savedItems, setSavedItems] = useState(context.envVars)
  const [isSaving, setIsSaving] = useState(false)
  const hasChanges = JSON.stringify(items) !== JSON.stringify(savedItems)

  function add() {
    setItems((current) => [...current, { key: '', value: '', environment: '' }])
  }

  function insertEnvFile(envFile: string) {
    const parsed = parseEnvFile(envFile)

    if (parsed.length === 0) {
      return
    }

    setItems((current) => [
      ...current.filter((item) => item.key || item.value),
      ...parsed.map((item) => ({ ...item, environment: '' })),
    ])
  }

  function handleEnvFilePaste(event: ClipboardEvent<HTMLElement>) {
    const pastedText = event.clipboardData.getData('text')

    if (!isEnvFilePaste(pastedText)) {
      return
    }

    event.preventDefault()
    insertEnvFile(pastedText)
  }

  function update(index: number, patch: Partial<ProjectEnvironmentVariable>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
  }

  async function save() {
    setIsSaving(true)

    try {
      await saveProjectEnvVars({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          envVars: items,
        },
      })
      setSavedItems(items)
      toast.success('Environment variables saved.')
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Unable to save environment variables.'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      {items.length > 0 ? (
        <div>
          <div className="grid grid-cols-[200px_minmax(0,1fr)_220px_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
            <span>Key</span>
            <span>Value</span>
            <span>Environment</span>
            <span />
          </div>
          {items.map((envVar, index) => (
            <div
              className="grid min-h-12 grid-cols-[200px_minmax(0,1fr)_220px_2rem] items-start gap-x-2 border-b py-2 text-sm"
              key={`env-var:${index}`}
            >
              <Input
                value={envVar.key}
                placeholder="e.g. MY_VAR"
                onChange={(event) => update(index, { key: event.target.value })}
                onPaste={handleEnvFilePaste}
              />
              <EnvVarValueTextarea
                value={envVar.value}
                onChange={(value) => update(index, { value })}
                onPaste={handleEnvFilePaste}
              />
              <Select
                value={envVar.environment || '__all__'}
                onValueChange={(environment) =>
                  update(index, {
                    environment: environment === '__all__' ? '' : environment,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All environments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    <EnvironmentOptionLabel label="All environments" />
                  </SelectItem>
                  {context.environments.map((environment) => (
                    <SelectItem
                      key={environment.id}
                      value={environment.id}
                      textValue={environment.name}
                    >
                      <EnvironmentOptionLabel
                        color={environment.color}
                        label={environment.name}
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-end">
                <IconActionTooltip label="Delete environment variable">
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    disabled={isSaving}
                    aria-label="Delete environment variable"
                  >
                    <Trash2Icon />
                  </Button>
                </IconActionTooltip>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex gap-x-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={isSaving}
        >
          <PlusIcon />
          Add variable
        </Button>
        <PasteEnvFileDialog onInsert={insertEnvFile} />
      </div>
      <div className="mt-6 flex justify-end gap-x-2">
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      </div>
    </div>
  )
}

function EnvVarValueTextarea({
  onChange,
  onPaste,
  value,
}: {
  onChange: (value: string) => void
  onPaste: (event: ClipboardEvent<HTMLElement>) => void
  value: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    resizeTextarea(ref.current)
  }, [value])

  return (
    <Textarea
      ref={ref}
      className="min-h-9 resize-none overflow-hidden break-all py-2 font-mono text-[13px]"
      value={value}
      onPaste={onPaste}
      onChange={(event) => {
        onChange(event.target.value)
        resizeTextarea(event.currentTarget)
      }}
    />
  )
}

function PasteEnvFileDialog({
  onInsert,
}: {
  onInsert: (envFile: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [envFile, setEnvFile] = useState('')

  function insert() {
    onInsert(envFile)
    setEnvFile('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              aria-label="Paste .env file"
              size="icon"
              type="button"
              variant="outline"
            >
              <FileTextIcon />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Paste .env file</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paste .env file</DialogTitle>
          <DialogDescription>
            Paste the contents of your .env file to add variables to this
            project.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="max-h-36 min-h-24 overflow-y-auto break-all font-mono text-[13px]"
          value={envFile}
          onChange={(event) => setEnvFile(event.target.value)}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!envFile.trim()} type="button" onClick={insert}>
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EnvironmentOptionLabel({
  color,
  label,
}: {
  color?: string
  label: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-x-2">
      {color ? <EnvironmentDot color={color} /> : null}
      <span className="truncate">{label}</span>
    </span>
  )
}

function normalizeDomainsForRoutes(
  domains: Array<ProjectDomainAlias>,
  routes: Array<ProjectRouteDefinition>,
) {
  const routePaths = new Set(routes.map((route) => route.path))

  return domains.map((domain) => ({
    ...domain,
    baseRoute:
      domain.baseRoute && routePaths.has(domain.baseRoute)
        ? domain.baseRoute
        : '',
  }))
}

function parseEnvFile(envFile: string) {
  return envFile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = /^([^=]+)=(.*)$/.exec(line)

      if (!match) {
        return null
      }

      return {
        key: match[1].trim(),
        value: match[2].trim().replace(/^["']|["']$/g, ''),
      }
    })
    .filter((item): item is { key: string; value: string } => Boolean(item))
}

function isEnvFilePaste(value: string) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  return (
    lines.length > 0 &&
    lines.every((line) => /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(line))
  )
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return
  }

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function ColorSelect({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Environment color"
          size="icon"
          type="button"
          variant="ghost"
        >
          <EnvironmentDot color={value} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-auto overflow-visible p-2"
      >
        <div className="grid grid-cols-6 gap-2">
          {environmentColors.map((color) => (
            <button
              aria-label={`Set environment color to ${color}`}
              className="flex size-6 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              key={color}
              onClick={() => onChange(color)}
              type="button"
            >
              <EnvironmentColorOption checked={value === color} color={color} />
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SettingsSection({
  title,
  description,
  children,
  footer,
  id,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  id: string
}) {
  return (
    <Card id={id} className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? (
        <CardFooter className="justify-end gap-x-2">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}

function IconActionTooltip({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SettingsActions({
  hasChanges,
  isSaving,
  onCancel,
  onSave,
}: {
  hasChanges: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: () => Promise<void>
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onCancel}
        disabled={!hasChanges || isSaving}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        type="button"
        onClick={() => void onSave()}
        disabled={!hasChanges || isSaving}
      >
        {isSaving ? <LoaderIcon className="animate-spin" /> : null}
        Save
      </Button>
    </>
  )
}
