import { Link, useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  LoaderIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ResourceAvatar } from '@/components/resource-avatar'
import { SectionNavigation } from '@/components/section-navigation'
import { getErrorMessage } from '@/lib/error-message'
import { setProjectContextQueryData } from '@/lib/project-context-query'
import {
  deleteProjectAction,
  saveProjectDomains,
  saveProjectRoutes,
  saveProjectSettings,
  verifyProjectDomainAction,
} from '@/server/projects/functions'
import type { ProjectContext, ProjectDomain } from '@/server/projects/service'
import {
  ProjectSettingsActionTooltip as IconActionTooltip,
  ProjectSettingsActions as SettingsActions,
  ProjectSettingsSection as SettingsSection,
} from './project-settings-section'
import { getEffectiveProjectRoutes as getEffectiveRouteDefinitions } from './project-settings-utils'
import { RepositoryPickerDialog } from './repository-picker-dialog'
import type { ProjectRepository } from './repository-picker-dialog'
import {
  DomainSettingsTable,
  ManagedIngressWarnings,
  RouteSettingsTable,
} from './project-routing-settings'
import type {
  ProjectDomainAlias,
  ProjectRouteDefinition,
} from './project-routing-settings'
import {
  EnvironmentServersSettingsSection,
  EnvironmentSettingsSection,
  EnvironmentVariablesSettingsSection,
} from './project-environment-settings'

const managedComposeCommand = 'docker compose up -d --no-build'

export function ProjectSettings({ context }: { context: ProjectContext }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const { project } = context
  const runtimeConfig = project.runtimeConfig
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
  const [composePath, setComposePath] = useState(runtimeConfig.path ?? '')
  const [releaseCommand, setReleaseCommand] = useState(
    runtimeConfig.releaseCommand ?? '',
  )
  const [releaseService, setReleaseService] = useState(
    runtimeConfig.releaseService ?? '',
  )
  const [readinessPath, setReadinessPath] = useState(
    runtimeConfig.readinessPath ?? '',
  )
  const [deployCommand, setDeployCommand] = useState(
    runtimeConfig.deployCommand ?? '',
  )
  const [rollbackCommand, setRollbackCommand] = useState(
    runtimeConfig.rollbackCommand ?? '',
  )
  const [deployTimeoutSeconds, setDeployTimeoutSeconds] = useState(
    String(runtimeConfig.timeoutSeconds),
  )
  const [routes, setRoutes] =
    useState<Array<ProjectRouteDefinition>>(initialRoutes)
  const [domains, setDomains] =
    useState<Array<ProjectDomainAlias>>(initialDomains)
  const [savedRoutes, setSavedRoutes] =
    useState<Array<ProjectRouteDefinition>>(initialRoutes)
  const [savedDomains, setSavedDomains] =
    useState<Array<ProjectDomainAlias>>(initialDomains)
  const defaultReleaseService =
    routes.find((route) => route.service.trim())?.service.trim() ??
    (context.composeMetadata?.services.length === 1
      ? context.composeMetadata.services[0]
      : null)
  const [savedSettings, setSavedSettings] = useState({
    projectName: project.name,
    composePath: runtimeConfig.path ?? '',
    releaseCommand: runtimeConfig.releaseCommand ?? '',
    releaseService: runtimeConfig.releaseService ?? '',
    readinessPath: runtimeConfig.readinessPath ?? '',
    deployCommand: runtimeConfig.deployCommand ?? '',
    rollbackCommand: runtimeConfig.rollbackCommand ?? '',
    deployTimeoutSeconds: String(runtimeConfig.timeoutSeconds),
  })
  const [isSaving, setIsSaving] = useState(false)
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(
    null,
  )
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
    readinessPath !== savedSettings.readinessPath ||
    deployCommand !== savedSettings.deployCommand ||
    rollbackCommand !== savedSettings.rollbackCommand ||
    deployTimeoutSeconds !== savedSettings.deployTimeoutSeconds
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
    setDeployCommand(savedSettings.deployCommand)
    setRollbackCommand(savedSettings.rollbackCommand)
    setDeployTimeoutSeconds(savedSettings.deployTimeoutSeconds)
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
        deployCommand: includeBuildChanges
          ? deployCommand
          : savedSettings.deployCommand,
        rollbackCommand: includeBuildChanges
          ? rollbackCommand
          : savedSettings.rollbackCommand,
        deployTimeoutSeconds: includeBuildChanges
          ? deployTimeoutSeconds
          : savedSettings.deployTimeoutSeconds,
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
          runtimeConfig: {
            type: 'compose',
            path: settings.composePath.trim() || null,
            releaseCommand: settings.releaseCommand.trim() || null,
            releaseService:
              !settings.releaseCommand.trim() || !settings.releaseService.trim()
                ? null
                : settings.releaseService.trim(),
            readinessPath: settings.readinessPath.trim() || null,
            deployCommand: settings.deployCommand.trim() || null,
            rollbackCommand: settings.rollbackCommand.trim() || null,
            timeoutSeconds: Number(settings.deployTimeoutSeconds),
          },
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
          composePath: nextContext.project.runtimeConfig.path ?? '',
          releaseCommand:
            nextContext.project.runtimeConfig.releaseCommand ?? '',
          releaseService:
            nextContext.project.runtimeConfig.releaseService ?? '',
          readinessPath: nextContext.project.runtimeConfig.readinessPath ?? '',
          deployCommand: nextContext.project.runtimeConfig.deployCommand ?? '',
          rollbackCommand:
            nextContext.project.runtimeConfig.rollbackCommand ?? '',
          deployTimeoutSeconds: String(
            nextContext.project.runtimeConfig.timeoutSeconds,
          ),
        }

        setSavedSettings((current) => ({
          ...current,
          ...nextBuildSettings,
        }))
        setComposePath(nextBuildSettings.composePath)
        setReleaseCommand(nextBuildSettings.releaseCommand)
        setReleaseService(nextBuildSettings.releaseService)
        setReadinessPath(nextBuildSettings.readinessPath)
        setDeployCommand(nextBuildSettings.deployCommand)
        setRollbackCommand(nextBuildSettings.rollbackCommand)
        setDeployTimeoutSeconds(nextBuildSettings.deployTimeoutSeconds)
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

  async function verifyDomain(domainId: string) {
    setVerifyingDomainId(domainId)

    try {
      const result = await verifyProjectDomainAction({
        data: {
          domainId,
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: project.name,
        },
      })
      const nextContext = result.context
      setProjectContextQueryData(queryClient, nextContext)
      const aliases = nextContext.domains.map(mapProjectDomainAlias)
      setSavedDomains(aliases)
      setDomains(aliases)
      if (result.verified) {
        toast.success('Domain verified.')
      } else {
        toast.error(result.message ?? 'Domain verification failed.')
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to verify domain.'))
    } finally {
      setVerifyingDomainId(null)
    }
  }

  function mapProjectDomainAlias(domain: ProjectDomain): ProjectDomainAlias {
    return {
      id: domain.id,
      host: domain.host,
      environment: domain.environmentId,
      baseRoute: domain.basePath ?? '',
      https: domain.https,
      status: domain.status,
      message: domain.message,
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
            title="Build & Deploy"
            description="Configure the Compose file, deployment commands, and health checks."
            footer={
              <SettingsActions
                hasChanges={hasBuildChanges}
                isSaving={isSaving}
                onCancel={resetBuildSettings}
                onSave={saveBuildSettings}
              />
            }
          >
            <div className="space-y-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="compose-path">
                    Compose file path
                  </FieldLabel>
                  <Input
                    id="compose-path"
                    placeholder="compose.yml"
                    value={composePath}
                    onChange={(event) => setComposePath(event.target.value)}
                  />
                  <FieldDescription>
                    Repository-relative path to the Compose file. Defaults to
                    compose.yml.
                  </FieldDescription>
                </Field>
                <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)]">
                  <Field>
                    <FieldLabel htmlFor="release-command">
                      Pre-deploy command
                    </FieldLabel>
                    <Textarea
                      id="release-command"
                      className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
                      rows={1}
                      value={releaseCommand}
                      onChange={(event) =>
                        setReleaseCommand(event.target.value)
                      }
                    />
                    <FieldDescription>
                      Runs once before services are updated. For example,{' '}
                      <code>php artisan migrate --force</code>. Leave empty to
                      skip.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="release-service">
                      Pre-deploy service
                    </FieldLabel>
                    <Input
                      id="release-service"
                      value={releaseService}
                      placeholder={
                        defaultReleaseService
                          ? `Default (${defaultReleaseService})`
                          : 'Select a service'
                      }
                      onChange={(event) =>
                        setReleaseService(event.target.value)
                      }
                    />
                    <FieldDescription>
                      Service to run the pre-deploy command.
                    </FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="deploy-command">
                    Deploy command
                  </FieldLabel>
                  <Textarea
                    id="deploy-command"
                    className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
                    rows={1}
                    value={deployCommand}
                    placeholder={managedComposeCommand}
                    onChange={(event) => setDeployCommand(event.target.value)}
                  />
                  <FieldDescription>
                    Runs on the server to update services after images and the
                    pre-deploy command are ready. When empty, uses{' '}
                    <code>{managedComposeCommand}</code>.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="rollback-command">
                    Rollback command
                  </FieldLabel>
                  <Textarea
                    id="rollback-command"
                    className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
                    rows={1}
                    value={rollbackCommand}
                    placeholder={deployCommand.trim() || managedComposeCommand}
                    onChange={(event) => setRollbackCommand(event.target.value)}
                  />
                  <FieldDescription>
                    Runs on the server when deploying a previous revision. When
                    empty, uses the deploy command.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="deploy-timeout">
                    Command timeout
                  </FieldLabel>
                  <Input
                    id="deploy-timeout"
                    type="number"
                    min={60}
                    max={7200}
                    step={60}
                    value={deployTimeoutSeconds}
                    onChange={(event) =>
                      setDeployTimeoutSeconds(event.target.value)
                    }
                  />
                  <FieldDescription>
                    Maximum runtime for either command: 60–7,200 seconds.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="readiness">Health check path</FieldLabel>
                  <Input
                    id="readiness"
                    value={readinessPath}
                    placeholder="/"
                    onChange={(event) => setReadinessPath(event.target.value)}
                  />
                  <FieldDescription>
                    Path requested after deployment to confirm the service is
                    ready.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </div>
          </SettingsSection>

          <EnvironmentSettingsSection context={context} />

          <EnvironmentVariablesSettingsSection context={context} />

          <EnvironmentServersSettingsSection context={context} />

          <SettingsSection
            id="routes"
            title="Routes"
            description="Default routes apply to every environment. Environment routes add paths or override the default target for the same path."
            footer={
              <SettingsActions
                hasChanges={hasRouteChanges}
                isSaving={isSaving}
                onCancel={resetRoutes}
                onSave={saveRoutes}
              />
            }
          >
            <div className="space-y-4">
              <ManagedIngressWarnings
                warnings={context.composeMetadata?.warnings ?? []}
              />
              <RouteSettingsTable
                routes={routes}
                environments={context.environments}
                onChange={setRoutes}
              />
            </div>
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
              onVerify={verifyDomain}
              verifyingDomainId={verifyingDomainId}
              verificationDisabled={hasDomainChanges}
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

        <aside className="hidden lg:block">
          <SectionNavigation
            className="sticky top-[122px]"
            items={[
              { href: '#general', label: 'General' },
              { href: '#build-and-deploy', label: 'Build & Deploy' },
              { href: '#environments', label: 'Environments' },
              {
                href: '#environment-variables',
                label: 'Environment variables',
              },
              { href: '#servers', label: 'Servers' },
              { href: '#routes', label: 'Routes' },
              { href: '#domains', label: 'Domains' },
              { href: '#danger', label: 'Danger', destructive: true },
            ]}
          />
        </aside>
      </div>
    </div>
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

function normalizeDomainsForRoutes(
  domains: Array<ProjectDomainAlias>,
  routes: Array<ProjectRouteDefinition>,
) {
  return domains.map((domain) => ({
    ...domain,
    baseRoute: getEffectiveRouteDefinitions(routes, domain.environment).some(
      (route) => route.path === domain.baseRoute,
    )
      ? domain.baseRoute
      : '',
  }))
}
