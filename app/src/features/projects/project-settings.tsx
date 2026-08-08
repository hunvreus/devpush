import { Link, useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  FileTextIcon,
  GithubIcon,
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
import { ButtonGroup } from '@/components/ui/button-group'
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
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
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
import { setProjectContextQueryData } from '@/lib/project-context-query'
import {
  getNewProjectContext,
  getRepositorySelectionRepositories,
  deleteProjectAction,
  saveProjectEnvironments,
  saveProjectDomains,
  saveProjectEnvVars,
  saveProjectRoutes,
  saveProjectEnvironmentServers,
  saveProjectSettings,
} from '@/server/projects/functions'
import type {
  ProjectContext,
  ProjectDomain,
  ProjectEnvironmentConfig,
  ProjectEnvironmentVariable,
  ProjectRoute,
  RepositorySelectionContext,
} from '@/server/projects/service'

export function ProjectSettings({ context }: { context: ProjectContext }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const { project } = context
  const initialRoutes = context.routes
  const autoReleaseService =
    context.routes.find((route) =>
      context.composeMetadata?.services.includes(route.service),
    )?.service ?? context.composeMetadata?.services.at(0)
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
  const [releaseService, setReleaseService] = useState(
    project.releaseService ?? '__auto__',
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
    releaseService: project.releaseService ?? '__auto__',
    readinessPath: project.readinessPath ?? '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isDeletingProject, setIsDeletingProject] = useState(false)
  const [deleteProjectConfirmation, setDeleteProjectConfirmation] = useState('')
  const [removeProjectDeployments, setRemoveProjectDeployments] = useState(true)
  const hasGeneralChanges =
    projectName !== savedSettings.projectName ||
    selectedRepo.fullName !== savedRepo.fullName ||
    selectedRepo.installationId !== savedRepo.installationId ||
    Boolean(avatarDataUrl) ||
    deleteAvatar
  const hasBuildChanges =
    composePath !== savedSettings.composePath ||
    releaseCommand !== savedSettings.releaseCommand ||
    releaseService !== savedSettings.releaseService ||
    readinessPath !== savedSettings.readinessPath
  const hasRouteChanges = JSON.stringify(routes) !== JSON.stringify(savedRoutes)
  const hasDomainChanges =
    JSON.stringify(domains) !== JSON.stringify(savedDomains)

  function resetGeneralSettings() {
    setProjectName(savedSettings.projectName)
    setSelectedRepo(savedRepo)
    setAvatarDataUrl(null)
    setDeleteAvatar(false)
  }

  function resetBuildSettings() {
    setComposePath(savedSettings.composePath)
    setReleaseCommand(savedSettings.releaseCommand)
    setReleaseService(savedSettings.releaseService)
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
    includeBuildChanges = false,
  }: {
    onSuccess?: (nextContext: ProjectContext) => void
    message?: string
    includeGeneralChanges?: boolean
    includeBuildChanges?: boolean
  } = {}) {
    setIsSaving(true)

    try {
      const settings = {
        projectName: includeGeneralChanges
          ? projectName
          : savedSettings.projectName,
        composePath: includeBuildChanges
          ? composePath
          : savedSettings.composePath,
        releaseCommand: includeBuildChanges
          ? releaseCommand
          : savedSettings.releaseCommand,
        releaseService: includeBuildChanges
          ? releaseService
          : savedSettings.releaseService,
        readinessPath: includeBuildChanges
          ? readinessPath
          : savedSettings.readinessPath,
      }
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
          releaseService:
            settings.releaseService === '__auto__'
              ? null
              : settings.releaseService,
          readinessPath: settings.readinessPath.trim() || null,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      onSuccess?.(nextContext)
      toast.success(message)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save settings.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function saveGeneralSettings() {
    await saveSettings({
      includeGeneralChanges: true,
      onSuccess: (nextContext) => {
        setSavedSettings((current) => ({
          ...current,
          projectName: nextContext.project.name,
        }))
        setProjectName(nextContext.project.name)
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

  async function saveBuildSettings() {
    await saveSettings({
      includeBuildChanges: true,
      onSuccess: (nextContext) => {
        const nextBuildSettings = {
          composePath: nextContext.project.composePath ?? 'compose.yml',
          releaseCommand: nextContext.project.releaseCommand ?? '',
          releaseService: nextContext.project.releaseService ?? '__auto__',
          readinessPath: nextContext.project.readinessPath ?? '',
        }

        setSavedSettings((current) => ({
          ...current,
          ...nextBuildSettings,
        }))
        setComposePath(nextBuildSettings.composePath)
        setReleaseCommand(nextBuildSettings.releaseCommand)
        setReleaseService(nextBuildSettings.releaseService)
        setReadinessPath(nextBuildSettings.readinessPath)
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
      setProjectContextQueryData(queryClient, nextContext)
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
      setProjectContextQueryData(queryClient, nextContext)
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
      id: domain.id,
      host: domain.host,
      environment: domain.environmentId,
      baseRoute: domain.basePath ?? '',
      https: domain.https,
    }
  }

  return (
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

      <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
        <div className="space-y-8">
          <SettingsSection
            id="general"
            title="General"
            description="General settings for the project including the Git repository."
            footer={
              <SettingsActions
                hasChanges={hasGeneralChanges}
                isSaving={isSaving}
                onCancel={resetGeneralSettings}
                onSave={saveGeneralSettings}
              />
            }
          >
            <div className="space-y-8">
              <Field>
                <FieldLabel>Avatar</FieldLabel>
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
                    <UploadIcon data-icon="inline-start" />
                    Upload image
                  </Button>
                  {avatarUrl ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          type="button"
                          aria-label="Remove image"
                          onClick={() => {
                            setAvatarDataUrl(null)
                            setDeleteAvatar(true)
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove image</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                <Input
                  id="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Git repository</FieldLabel>
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
                      className="rounded-r-none border-r-0 font-normal"
                    >
                      <img
                        data-icon="inline-start"
                        src={`https://github.com/${selectedRepoOwner}.png`}
                        alt=""
                        className="size-5 rounded"
                      />
                      {selectedRepo.fullName}
                      <ChevronsUpDownIcon
                        data-icon="inline-end"
                        className="text-muted-foreground group-hover/button:text-muted-foreground"
                      />
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
              </Field>
              <Field>
                <FieldLabel htmlFor="project-id">Project ID</FieldLabel>
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
                <FieldDescription>
                  A unique identifier used in API, environment variables, etc.
                </FieldDescription>
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection
            id="build-and-deploy"
            title="Build and Deploy"
            description="Configuration for deploying the Compose project: compose file, release command, readiness check, etc."
            footer={
              <SettingsActions
                hasChanges={hasBuildChanges}
                isSaving={isSaving}
                onCancel={resetBuildSettings}
                onSave={saveBuildSettings}
              />
            }
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="compose-path">
                  Compose file path
                </FieldLabel>
                <Input
                  id="compose-path"
                  value={composePath}
                  onChange={(event) => setComposePath(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="release-command">
                  Release command
                </FieldLabel>
                <Input
                  id="release-command"
                  value={releaseCommand}
                  placeholder="php artisan migrate --force"
                  onChange={(event) => setReleaseCommand(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="release-service">
                  Release service
                </FieldLabel>
                <Select
                  value={releaseService}
                  onValueChange={setReleaseService}
                >
                  <SelectTrigger id="release-service" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">
                      First valid service
                      {autoReleaseService ? ` (${autoReleaseService})` : ''}
                    </SelectItem>
                    {context.composeMetadata?.services.map((service) => (
                      <SelectItem key={service} value={service}>
                        {service}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  The service used to run the release command. Automatic uses
                  the first routed service, then the first Compose service.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="readiness">Readiness path</FieldLabel>
                <Input
                  id="readiness"
                  value={readinessPath}
                  placeholder="/health"
                  onChange={(event) => setReadinessPath(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </SettingsSection>

          <EnvironmentSettingsSection context={context} />

          <EnvironmentVariablesSettingsSection context={context} />

          <EnvironmentServersSettingsSection context={context} />

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
                      <LoaderIcon
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Trash2Icon data-icon="inline-start" />
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
                    <Field>
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
                    </Field>
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

        <aside className="hidden text-sm lg:block">
          <nav className="sticky top-[122px] flex flex-col gap-y-1">
            <Button asChild variant="ghost" className="justify-start">
              <a href="#general">General</a>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="#build-and-deploy">Build and Deploy</a>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="#environments">Environments</a>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="#environment-variables">Environment variables</a>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="#servers">Servers</a>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="#routes">Routes</a>
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="#domains">Domains</a>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <a href="#danger">Danger</a>
            </Button>
          </nav>
        </aside>
      </div>
    </div>
  )
}

type ProjectRouteDefinition = ProjectRoute

type ProjectDomainAlias = {
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

type Installation = Extract<
  RepositorySelectionContext['github'],
  { connected: true }
>['installations'][number]

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
        <>
          <div>
            <div className="grid w-full grid-cols-[minmax(0,1.35fr)_1rem_minmax(0,1.35fr)_minmax(5.5rem,0.45fr)_3.5rem_2.5rem] gap-x-2 border-b pb-2 text-sm font-medium">
              <div>Path</div>
              <div />
              <div>Service</div>
              <div>Port</div>
              <div>Strip</div>
              <div />
            </div>
            {routes.map((route, index) => (
              <div
                className="grid w-full grid-cols-[minmax(0,1.35fr)_1rem_minmax(0,1.35fr)_minmax(5.5rem,0.45fr)_3.5rem_2.5rem] items-center gap-x-2 border-b py-2"
                key={index}
              >
                <Field className="gap-0">
                  <Input
                    aria-label="Route path"
                    value={route.path}
                    onChange={(event) =>
                      updateRoute(index, { path: event.target.value })
                    }
                    placeholder="/"
                  />
                </Field>
                <ArrowRightIcon className="mx-auto size-4 text-muted-foreground" />
                <Field className="gap-0">
                  <Input
                    aria-label="Route service"
                    value={route.service}
                    onChange={(event) =>
                      updateRoute(index, { service: event.target.value })
                    }
                    placeholder="web"
                  />
                </Field>
                <Field className="gap-0">
                  <Input
                    aria-label="Route port"
                    type="number"
                    min={1}
                    max={65535}
                    value={route.port}
                    onChange={(event) =>
                      updateRoute(index, { port: Number(event.target.value) })
                    }
                    placeholder="3000"
                  />
                </Field>
                <div className="flex h-full items-center gap-2">
                  <Switch
                    aria-label="Strip route prefix"
                    checked={route.stripPrefix}
                    onCheckedChange={(checked) =>
                      updateRoute(index, { stripPrefix: checked })
                    }
                  />
                </div>
                <div className="flex justify-end">
                  <IconActionTooltip label="Remove route">
                    <Button
                      variant="destructive"
                      size="icon"
                      type="button"
                      aria-label="Remove route"
                      onClick={() => removeRoute(index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </IconActionTooltip>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" type="button" onClick={addRoute}>
            <PlusIcon data-icon="inline-start" />
            Add route
          </Button>
        </>
      ) : (
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyTitle>No routes configured.</EmptyTitle>
            <EmptyDescription>
              Add a route to expose a Compose service.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" type="button" onClick={addRoute}>
              <PlusIcon data-icon="inline-start" />
              Add route
            </Button>
          </EmptyContent>
        </Empty>
      )}
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
      {domains.length > 0 ? (
        <>
          <div>
            <div className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_2.5rem] gap-x-2 border-b pb-2 text-sm font-medium">
              <div>Host</div>
              <div>Environment</div>
              <div>Base route</div>
              <div>HTTPS</div>
              <div />
            </div>
            {domains.map((domain) => (
              <div
                className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_2.5rem] items-center gap-x-2 border-b py-2"
                key={domain.id}
              >
                <Field className="gap-0">
                  <Input
                    aria-label="Domain host"
                    value={domain.host}
                    onChange={(event) =>
                      updateDomain(domain.id, { host: event.target.value })
                    }
                    placeholder="myapp.com"
                  />
                </Field>
                <Field className="gap-0">
                  <Select
                    value={domain.environment}
                    onValueChange={(value) =>
                      updateDomain(domain.id, { environment: value })
                    }
                  >
                    <SelectTrigger
                      aria-label="Domain environment"
                      className="w-full"
                    >
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
                </Field>
                <Field className="gap-0">
                  <Select
                    value={domain.baseRoute || 'all'}
                    onValueChange={(value) =>
                      updateDomain(domain.id, {
                        baseRoute: value === 'all' ? '' : value,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label="Domain base route"
                      className="w-full"
                    >
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
                </Field>
                <div className="flex h-full items-center justify-center">
                  <Switch
                    aria-label="HTTPS"
                    checked={domain.https}
                    onCheckedChange={(checked) =>
                      updateDomain(domain.id, { https: checked })
                    }
                  />
                </div>
                <div className="flex justify-end">
                  <IconActionTooltip label="Remove domain">
                    <Button
                      variant="destructive"
                      size="icon"
                      type="button"
                      aria-label="Remove domain"
                      onClick={() => removeDomain(domain.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </IconActionTooltip>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" type="button" onClick={addDomain}>
            <PlusIcon data-icon="inline-start" />
            Add domain
          </Button>
        </>
      ) : (
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyTitle>No custom domains.</EmptyTitle>
            <EmptyDescription>
              Add a domain and map it to an environment route.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" type="button" onClick={addDomain}>
              <PlusIcon data-icon="inline-start" />
              Add domain
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}

function EnvironmentSettingsSection({ context }: { context: ProjectContext }) {
  const queryClient = useQueryClient()
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
        position: current.length,
        status: 'active',
        effectiveServerId: context.project.defaultServerId,
        serverId: null,
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
      const nextContext = await saveProjectEnvironments({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          environments: items,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setItems(nextContext.environments)
      setSavedItems(nextContext.environments)
      toast.success('Environments saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save environments.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection
      id="environments"
      title="Environments"
      description="Deployments will be associated with the first environment with a matching branch pattern."
      footer={
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      }
    >
      <div>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2rem] gap-x-2 border-b pb-3 text-sm font-medium">
          <span>Name</span>
          <span>Identifier</span>
          <span>Branch</span>
          <span />
        </div>
        {items.map((environment) => (
          <div
            className="grid min-h-12 grid-cols-[repeat(3,minmax(0,1fr))_2rem] items-center gap-x-2 border-b py-2 text-sm"
            key={environment.id}
          >
            <Field className="gap-0">
              <div className="flex min-w-0 items-center">
                <ColorSelect
                  value={environment.color}
                  onChange={(color) => update(environment.id, { color })}
                />
                <Input
                  aria-label="Environment name"
                  className="rounded-l-none"
                  value={environment.name}
                  placeholder="Production"
                  onChange={(event) =>
                    update(environment.id, { name: event.target.value })
                  }
                />
              </div>
            </Field>
            <Field className="gap-0">
              <Input
                aria-label="Environment identifier"
                value={environment.slug}
                placeholder="production"
                readOnly={environment.slug === 'production'}
                onChange={(event) =>
                  update(environment.id, { slug: event.target.value })
                }
              />
            </Field>
            <Field className="gap-0">
              <Input
                aria-label="Environment branch"
                value={environment.branch}
                placeholder="main"
                onChange={(event) =>
                  update(environment.id, { branch: event.target.value })
                }
              />
            </Field>
            <div className="flex items-center justify-end">
              <IconActionTooltip label="Remove environment">
                <Button
                  size="icon"
                  variant="destructive"
                  type="button"
                  onClick={() => remove(environment)}
                  disabled={isSaving || environment.slug === 'production'}
                  aria-label="Remove environment"
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
          onClick={add}
          disabled={isSaving}
        >
          <PlusIcon data-icon="inline-start" />
          Add environment
        </Button>
      </div>
    </SettingsSection>
  )
}

function EnvironmentServersSettingsSection({
  context,
}: {
  context: ProjectContext
}) {
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const initialItems = context.environments.map((environment) => ({
    environmentId: environment.id,
    serverId: environment.serverId,
  }))
  const [defaultServerId, setDefaultServerId] = useState(
    context.project.defaultServerId,
  )
  const [savedDefaultServerId, setSavedDefaultServerId] = useState(
    context.project.defaultServerId,
  )
  const [items, setItems] = useState(initialItems)
  const [savedItems, setSavedItems] = useState(initialItems)
  const [isSaving, setIsSaving] = useState(false)
  const hasChanges =
    defaultServerId !== savedDefaultServerId ||
    JSON.stringify(items) !== JSON.stringify(savedItems)

  function update(environmentId: string, serverId: string | null) {
    setItems((current) =>
      current.map((item) =>
        item.environmentId === environmentId ? { ...item, serverId } : item,
      ),
    )
  }

  async function save() {
    setIsSaving(true)

    try {
      const nextContext = await saveProjectEnvironmentServers({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          defaultServerId,
          environmentServers: items,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      const nextItems = nextContext.environments.map((environment) => ({
        environmentId: environment.id,
        serverId: environment.serverId,
      }))
      setItems(nextItems)
      setSavedItems(nextItems)
      setDefaultServerId(nextContext.project.defaultServerId)
      setSavedDefaultServerId(nextContext.project.defaultServerId)
      toast.success('Servers saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save servers.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsSection
      id="servers"
      title="Servers"
      description="Choose a default server, then override individual environments when needed."
      footer={
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => {
            setDefaultServerId(savedDefaultServerId)
            setItems(savedItems)
          }}
          onSave={save}
        />
      }
    >
      <div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-b pb-3 text-sm font-medium">
          <span>Scope</span>
          <span>Server</span>
        </div>
        <div className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 border-b py-2 text-sm">
          <span className="font-medium">Default</span>
          <ServerAssignmentControl
            ariaLabel="Default server"
            context={context}
            serverId={defaultServerId}
            onChange={setDefaultServerId}
          />
        </div>
        {context.environments.map((environment) => {
          const assignment = items.find(
            (item) => item.environmentId === environment.id,
          )

          return (
            <div
              className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 border-b py-2 text-sm"
              key={environment.id}
            >
              <EnvironmentOptionLabel
                color={environment.color}
                label={environment.name}
              />
              <ServerAssignmentControl
                ariaLabel={`${environment.name} server override`}
                context={context}
                defaultServerId={defaultServerId}
                serverId={assignment?.serverId ?? null}
                onChange={(serverId) => update(environment.id, serverId)}
              />
            </div>
          )
        })}
      </div>
    </SettingsSection>
  )
}

function ServerAssignmentControl({
  ariaLabel,
  context,
  defaultServerId,
  serverId,
  onChange,
}: {
  ariaLabel: string
  context: ProjectContext
  defaultServerId?: string | null
  serverId: string | null
  onChange: (serverId: string | null) => void
}) {
  const effectiveServerId = serverId ?? defaultServerId ?? null
  const selectedServer = context.servers.find(
    (server) => server.id === effectiveServerId,
  )
  const defaultServer = context.servers.find(
    (server) => server.id === defaultServerId,
  )
  const inheritedLabel = defaultServer
    ? `Use default (${defaultServer.name})`
    : 'Use default (none)'

  return (
    <ButtonGroup className="min-w-0 w-full">
      <Select
        value={
          serverId ??
          (defaultServerId === undefined ? '__none__' : '__default__')
        }
        onValueChange={(value) =>
          onChange(
            value === '__none__' || value === '__default__' ? null : value,
          )
        }
      >
        <SelectTrigger aria-label={ariaLabel} className="min-w-0 flex-1 w-auto">
          <SelectValue placeholder="Select a server" />
        </SelectTrigger>
        <SelectContent>
          {defaultServerId === undefined ? (
            <SelectItem value="__none__">No default server</SelectItem>
          ) : (
            <SelectItem value="__default__">{inheritedLabel}</SelectItem>
          )}
          {context.servers.map((server) => (
            <SelectItem
              key={server.id}
              value={server.id}
              textValue={server.name}
            >
              <span className="flex items-center gap-x-2">
                <ServerAvatar name={server.name} status={server.status} />
                {server.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <IconActionTooltip label="Server details">
        <Button
          size="icon"
          variant="outline"
          className="text-muted-foreground hover:text-foreground"
          type="button"
          disabled={!selectedServer}
          aria-label="Server details"
          asChild={Boolean(selectedServer)}
        >
          {selectedServer ? (
            <Link
              to="/$teamSlug/servers/$serverId"
              params={{
                teamSlug: context.team.slug,
                serverId: selectedServer.id,
              }}
            >
              <ArrowRightIcon />
            </Link>
          ) : (
            <ArrowRightIcon />
          )}
        </Button>
      </IconActionTooltip>
    </ButtonGroup>
  )
}

function EnvironmentVariablesSettingsSection({
  context,
}: {
  context: ProjectContext
}) {
  const queryClient = useQueryClient()
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
      const nextContext = await saveProjectEnvVars({
        data: {
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: context.project.name,
          envVars: items,
        },
      })
      setProjectContextQueryData(queryClient, nextContext)
      setItems(nextContext.envVars)
      setSavedItems(nextContext.envVars)
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
    <SettingsSection
      id="environment-variables"
      title="Environment variables"
      description="Variables available at build time and runtime. Changes will take effect after a new deployment."
      footer={
        <SettingsActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          onCancel={() => setItems(savedItems)}
          onSave={save}
        />
      }
    >
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
                <Field className="gap-0">
                  <Input
                    aria-label="Environment variable key"
                    value={envVar.key}
                    placeholder="e.g. MY_VAR"
                    onChange={(event) =>
                      update(index, { key: event.target.value })
                    }
                    onPaste={handleEnvFilePaste}
                  />
                </Field>
                <Field className="gap-0">
                  <EnvVarValueTextarea
                    value={envVar.value}
                    onChange={(value) => update(index, { value })}
                    onPaste={handleEnvFilePaste}
                  />
                </Field>
                <Field className="gap-0">
                  <Select
                    value={envVar.environment || '__all__'}
                    onValueChange={(environment) =>
                      update(index, {
                        environment:
                          environment === '__all__' ? '' : environment,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label="Environment variable environment"
                      className="w-full"
                    >
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
                </Field>
                <div className="flex items-center justify-end">
                  <IconActionTooltip label="Remove environment variable">
                    <Button
                      size="icon"
                      variant="destructive"
                      type="button"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      disabled={isSaving}
                      aria-label="Remove environment variable"
                    >
                      <Trash2Icon />
                    </Button>
                  </IconActionTooltip>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty className="min-h-40">
            <EmptyHeader>
              <EmptyTitle>No environment variables.</EmptyTitle>
              <EmptyDescription>
                Add variables available to builds and deployments.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={add}
                disabled={isSaving}
              >
                <PlusIcon data-icon="inline-start" />
                Add variable
              </Button>
              <PasteEnvFileDialog onInsert={insertEnvFile} />
            </EmptyContent>
          </Empty>
        )}
        {items.length > 0 ? (
          <div className="mt-3 flex gap-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={add}
              disabled={isSaving}
            >
              <PlusIcon data-icon="inline-start" />
              Add variable
            </Button>
            <PasteEnvFileDialog onInsert={insertEnvFile} />
          </div>
        ) : null}
      </div>
    </SettingsSection>
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
      aria-label="Environment variable value"
      className="min-h-8 resize-none overflow-hidden break-all py-1.5 font-mono text-[13px]"
      placeholder="value"
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
        <Field>
          <FieldLabel htmlFor="env-file-content">.env content</FieldLabel>
          <Textarea
            id="env-file-content"
            className="max-h-36 min-h-24 overflow-y-auto break-all font-mono text-[13px]"
            value={envFile}
            onChange={(event) => setEnvFile(event.target.value)}
          />
        </Field>
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
          className="rounded-r-none border-r-0 text-foreground hover:bg-input/50 hover:text-foreground"
          size="icon"
          type="button"
          variant="outline"
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
              className="flex size-7 items-center justify-center rounded-full border border-transparent transition-colors hover:border-foreground/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        type="button"
        onClick={onCancel}
        disabled={!hasChanges || isSaving}
      >
        Cancel
      </Button>
      <Button
        type="button"
        onClick={() => void onSave()}
        disabled={!hasChanges || isSaving}
      >
        {isSaving ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Save
      </Button>
    </>
  )
}
