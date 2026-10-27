import { NotificationMute } from '#devpush/features/notifications/email-preferences'
import { useImageUploads } from '#devpush/components/storage-capabilities'
import {
  mutationErrorOptions,
  afterMutation,
} from '#devpush/lib/action-feedback'
import { showSettingsConflict } from '#devpush/lib/settings-conflict'
import { CopyButton } from '#devpush/components/copy-button'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'
import {
  projectRoutesSchema,
  projectDomainsSchema,
} from '#devpush/lib/project-routing-schema'
import { formErrors } from '#devpush/lib/form-errors'
import {
  projectSettingsSchema,
  projectValidationErrors,
} from '#devpush/lib/project-settings-schema'
import type { FormErrors } from '#devpush/lib/form-errors'
import { useAvatarInput } from '#devpush/lib/use-avatar-input'
import { useParams, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  ChevronsUpDownIcon,
  LoaderIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useSettingsVersion } from '#devpush/lib/use-settings-version'
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
} from '#devpush/components/ui/alert-dialog'
import { Button } from '#devpush/components/ui/button'
import { Checkbox } from '#devpush/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import { Textarea } from '#devpush/components/ui/textarea'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import {
  SettingsLayout,
  SettingsSection,
} from '#devpush/components/settings-layout'
import { ResourceAvatar } from '#devpush/components/resource-avatar'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { setProjectContextQueryData } from '#devpush/lib/project-context-query'
import { canManageTeamSettings } from '#devpush/lib/team-role'
import {
  deleteProjectAction,
  saveProjectDomains,
  saveProjectRoutes,
  saveProjectSettings,
  verifyProjectDomainAction,
} from '#devpush/server/projects/functions'
import type {
  ProjectContext,
  ProjectDomain,
} from '#devpush/server/projects/types'
import {
  ProjectSettingsActionTooltip as IconActionTooltip,
  ProjectSettingsActions as SettingsActions,
} from './project-settings-section'
import {
  getEffectiveProjectRoutes as getEffectiveRouteDefinitions,
  projectSettingsNavigationItems,
} from './project-settings-utils'
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
import { ProjectHeading } from './project-heading'
import {
  EnvironmentServersSettingsSection,
  EnvironmentSettingsSection,
  EnvironmentVariablesSettingsSection,
} from './project-environment-settings'

const managedComposeCommand = 'docker compose up -d --no-build'

export function ProjectSettings({ context }: { context: ProjectContext }) {
  const router = useRouter()
  const imageUploads = useImageUploads()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const { project } = context
  const canManageLifecycleCommands = canManageTeamSettings(context.team.role)
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
  const {
    dataUrl: avatarDataUrl,
    setDataUrl: setAvatarDataUrl,
    read: readAvatar,
    cancelRead: cancelAvatarRead,
    pending: isReadingAvatar,
  } = useAvatarInput()
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
  const [generalErrors, setGeneralErrors] = useState<FormErrors>({})
  const [buildErrors, setBuildErrors] = useState<FormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(
    null,
  )
  const [isDeletingProject, setIsDeletingProject] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [projectDeleted, setProjectDeleted] = useState(false)
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

  const generalVersion = useSettingsVersion({
    version: project.settingsVersion,
    dirty: hasGeneralChanges || isReadingAvatar,
    saving: isSaving,
    refresh: () => {
      const repo = {
        fullName: project.githubRepo,
        id: project.githubRepoId,
        installationId: project.githubInstallationId,
      }
      setProjectName(project.name)
      setSelectedRepo(repo)
      setSavedRepo(repo)
      setSavedAvatarUrl(project.avatarUrl)
      setSavedSettings((current) => ({ ...current, projectName: project.name }))
      setGeneralErrors({})
    },
  })
  const buildVersion = useSettingsVersion({
    version: project.settingsVersion,
    dirty: hasBuildChanges,
    saving: isSaving,
    refresh: () => {
      const build = {
        composePath: runtimeConfig.path ?? '',
        releaseCommand: runtimeConfig.releaseCommand ?? '',
        releaseService: runtimeConfig.releaseService ?? '',
        readinessPath: runtimeConfig.readinessPath ?? '',
        deployCommand: runtimeConfig.deployCommand ?? '',
        rollbackCommand: runtimeConfig.rollbackCommand ?? '',
        deployTimeoutSeconds: String(runtimeConfig.timeoutSeconds),
      }
      setComposePath(build.composePath)
      setReleaseCommand(build.releaseCommand)
      setReleaseService(build.releaseService)
      setReadinessPath(build.readinessPath)
      setDeployCommand(build.deployCommand)
      setRollbackCommand(build.rollbackCommand)
      setDeployTimeoutSeconds(build.deployTimeoutSeconds)
      setSavedSettings((current) => ({ ...current, ...build }))
      setBuildErrors({})
    },
  })
  const routesVersion = useSettingsVersion({
    version: project.settingsVersion,
    dirty: hasRouteChanges,
    saving: isSaving,
    refresh: () => {
      setRoutes(initialRoutes)
      setSavedRoutes(initialRoutes)
    },
  })
  const domainsVersion = useSettingsVersion({
    version: project.settingsVersion,
    dirty: hasDomainChanges,
    saving: isSaving,
    refresh: () => {
      setDomains(initialDomains)
      setSavedDomains(initialDomains)
    },
  })

  function resetGeneralSettings() {
    setGeneralErrors({})
    setProjectName(savedSettings.projectName)
    setSelectedRepo(savedRepo)
    setAvatarDataUrl(null)
    setDeleteAvatar(false)
  }

  function resetBuildSettings() {
    setBuildErrors({})
    setComposePath(savedSettings.composePath)
    setReleaseCommand(savedSettings.releaseCommand)
    setReleaseService(savedSettings.releaseService)
    setReadinessPath(savedSettings.readinessPath)
    setDeployCommand(savedSettings.deployCommand)
    setRollbackCommand(savedSettings.rollbackCommand)
    setDeployTimeoutSeconds(savedSettings.deployTimeoutSeconds)
  }

  const [routeErrors, setRouteErrors] = useState<FormErrors>({})
  const [domainErrors, setDomainErrors] = useState<FormErrors>({})

  function resetRoutes() {
    setRouteErrors({})
    setRoutes(savedRoutes)
  }

  function resetDomains() {
    setDomainErrors({})
    setDomains(savedDomains)
  }

  async function saveSettings({
    onSuccess,
    message = 'Project settings saved.',
    includeGeneralChanges = false,
    includeBuildChanges = false,
  }: {
    onSuccess?: (nextContext: ProjectContext) => void | Promise<void>
    message?: string
    includeGeneralChanges?: boolean
    includeBuildChanges?: boolean
  } = {}) {
    if (isSaving || (includeGeneralChanges && isReadingAvatar)) return
    const setErrors = includeGeneralChanges ? setGeneralErrors : setBuildErrors
    setErrors({})

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

      const parsed = projectSettingsSchema.safeParse({
        projectId: project.id,
        section: includeGeneralChanges ? 'general' : 'build',
        settingsVersion: (includeGeneralChanges ? generalVersion : buildVersion)
          .current,
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
      })
      if (!parsed.success) {
        const errors = projectValidationErrors(parsed.error.issues)
        if (errors.form) toast.error(errors.form)
        setErrors(errors)
        const id = projectSettingsFieldIds[Object.keys(errors)[0] ?? '']
        if (id) document.getElementById(id)?.focus()
        return
      }
      setIsSaving(true)
      const result = await saveProjectSettings({ data: parsed.data })
      if (result.fieldErrors) {
        if (result.fieldErrors.form) toast.error(result.fieldErrors.form)
        setErrors(result.fieldErrors)
        return
      }
      const nextContext = result.context
      const savedVersion = includeGeneralChanges ? generalVersion : buildVersion
      savedVersion.current = nextContext.project.settingsVersion
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      await onSuccess?.(nextContext)
      toast.success(message)
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to save settings. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function saveGeneralSettings() {
    if (!hasGeneralChanges) return
    await saveSettings({
      includeGeneralChanges: true,
      onSuccess: async (nextContext) => {
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
          await afterMutation(
            () =>
              router.navigate({
                to: '/$teamSlug/projects/$projectName/settings',
                params: {
                  teamSlug: nextContext.team.slug,
                  projectName: nextContext.project.name,
                },
              }),
            'The action completed, but opening the next page failed. Please reload.',
          )
        }
      },
    })
  }

  async function saveBuildSettings() {
    if (!hasBuildChanges) return
    await saveSettings({
      includeBuildChanges: true,
      onSuccess: async (nextContext) => {
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
    if (
      isDeletingProject ||
      projectDeleted ||
      deleteProjectConfirmation !== project.name ||
      !['owner', 'admin'].includes(context.team.role)
    )
      return

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
      await invalidateResourceQueries(queryClient, teamSlug)
      setProjectDeleted(true)
      setDeleteOpen(false)
      toast.success('Project deleted.')
      await afterMutation(
        () =>
          router.navigate({
            to: '/$teamSlug/projects',
            params: { teamSlug },
          }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to delete project. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsDeletingProject(false)
    }
  }

  async function chooseAvatar(file: File | undefined) {
    if (!file) return
    cancelAvatarRead()
    setGeneralErrors((current) => ({ ...current, avatarDataUrl: undefined }))

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setGeneralErrors((current) => ({
        ...current,
        avatarDataUrl: 'Upload a PNG, JPEG, or WebP image.',
      }))
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setGeneralErrors((current) => ({
        ...current,
        avatarDataUrl: 'Avatars must be 2 MB or smaller.',
      }))
      return
    }

    try {
      const dataUrl = await readAvatar(file)
      if (dataUrl === null) return
      setAvatarDataUrl(dataUrl)
      setDeleteAvatar(false)
    } catch {
      setGeneralErrors((current) => ({
        ...current,
        avatarDataUrl:
          'Unable to read this image. Please choose it again or try another file.',
      }))
    }
  }

  const avatarUrl = deleteAvatar
    ? undefined
    : (avatarDataUrl ?? savedAvatarUrl ?? undefined)
  const selectedRepoOwner =
    selectedRepo.fullName.split('/')[0] ?? selectedRepo.fullName

  async function saveRoutes() {
    if (isSaving || verifyingDomainId || !hasRouteChanges) return
    const parsed = projectRoutesSchema.safeParse({
      projectId: project.id,
      settingsVersion: routesVersion.current,
      teamSlug: params.teamSlug,
      projectName: project.name,
      routes,
    })
    const errors: FormErrors = parsed.success
      ? {}
      : formErrors(parsed.error.issues)
    routes.forEach((route, index) => {
      if (
        route.environmentId &&
        !context.environments.some((env) => env.id === route.environmentId)
      )
        errors[`routes.${index}.environmentId`] = 'Select a valid environment.'
    })
    if (errors.form) toast.error(errors.form)
    setRouteErrors(errors)
    if (!parsed.success || Object.keys(errors).length) {
      const firstField = Object.keys(errors)[0]
      if (firstField) document.getElementById(firstField)?.focus()
      return
    }
    setIsSaving(true)

    try {
      const nextContext = await saveProjectRoutes({
        data: {
          projectId: project.id,
          settingsVersion: routesVersion.current,
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: project.name,
          routes: parsed.data.routes,
        },
      })
      routesVersion.current = nextContext.project.settingsVersion
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      const aliases = nextContext.domains.map(mapProjectDomainAlias)
      setSavedRoutes(nextContext.routes)
      setRoutes(nextContext.routes)
      setSavedDomains(aliases)
      setDomains(
        hasDomainChanges
          ? normalizeDomainsForRoutes(domains, nextContext.routes)
          : aliases,
      )
      toast.success('Routes saved.')
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to save routes. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function saveDomains() {
    if (isSaving || verifyingDomainId || !hasDomainChanges) return
    const nextDomains = normalizeDomainsForRoutes(domains, savedRoutes)
    const parsed = projectDomainsSchema.safeParse({
      projectId: project.id,
      settingsVersion: domainsVersion.current,
      teamSlug: params.teamSlug,
      projectName: project.name,
      domains: nextDomains.map((domain) => ({
        host: domain.host,
        environmentId: domain.environment,
        basePath: domain.baseRoute,
        https: domain.https,
      })),
    })
    const errors: FormErrors = parsed.success
      ? {}
      : formErrors(parsed.error.issues)
    domains.forEach((domain, index) => {
      if (!context.environments.some((env) => env.id === domain.environment))
        errors[`domains.${index}.environmentId`] = 'Select a valid environment.'
    })
    if (errors.form) toast.error(errors.form)
    setDomainErrors(errors)
    if (!parsed.success || Object.keys(errors).length) {
      const firstField = Object.keys(errors)[0]
      if (firstField) document.getElementById(firstField)?.focus()
      return
    }
    setIsSaving(true)

    try {
      const nextContext = await saveProjectDomains({
        data: {
          projectId: project.id,
          settingsVersion: domainsVersion.current,
          teamSlug: typeof params.teamSlug === 'string' ? params.teamSlug : '',
          projectName: project.name,
          domains: parsed.data.domains,
        },
      })
      domainsVersion.current = nextContext.project.settingsVersion
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      const aliases = nextContext.domains.map(mapProjectDomainAlias)
      setSavedDomains(aliases)
      setDomains(aliases)
      toast.success('Domains saved.')
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to save domains. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function verifyDomain(domainId: string) {
    if (isSaving || verifyingDomainId || hasDomainChanges) return
    setDomainErrors({})
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
      await setProjectContextQueryData(queryClient, nextContext, 'settings')
      const aliases = nextContext.domains.map(mapProjectDomainAlias)
      setSavedDomains(aliases)
      setDomains(aliases)
      if (result.verified) {
        toast.success('Domain verified.')
      } else {
        toast.error(result.message ?? 'Domain verification failed.')
      }
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to verify domain. Please try again.',
        ),
        ...mutationErrorOptions(error),
      )
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
      <ProjectHeading
        teamSlug={typeof params.teamSlug === 'string' ? params.teamSlug : ''}
        project={{ ...project, avatarUrl }}
        crumbs={[<span>Project settings</span>]}
      />

      <SettingsLayout navigation={projectSettingsNavigationItems}>
        <SettingsSection
          id="general"
          title="General"
          description="General settings for the project including the Git repository."
          footer={
            <SettingsActions
              form="project-general-form"
              hasChanges={hasGeneralChanges || isReadingAvatar}
              saveDisabled={isReadingAvatar}
              isSaving={isSaving}
              onCancel={resetGeneralSettings}
              onSave={saveGeneralSettings}
            />
          }
        >
          <form
            id="project-general-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveGeneralSettings()
            }}
          >
            <fieldset disabled={isSaving} className="space-y-8">
              <Field>
                <FieldLabel>Avatar</FieldLabel>
                <div className="flex items-center gap-x-2">
                  <ResourceAvatar
                    name={project.name}
                    src={avatarUrl}
                    color={project.color}
                    size="md"
                  />
                  {imageUploads ? (
                    <input
                      ref={avatarInputRef}
                      aria-label="Avatar image"
                      aria-invalid={Boolean(generalErrors.avatarDataUrl)}
                      aria-describedby="project-avatar-error"
                      className="sr-only"
                      type="file"
                      disabled={isSaving}
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        void chooseAvatar(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  ) : null}
                  {imageUploads ? (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      id="project-avatar-button"
                      aria-invalid={Boolean(generalErrors.avatarDataUrl)}
                      aria-describedby="project-avatar-error"
                      disabled={isSaving}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <UploadIcon data-icon="inline-start" />
                      Upload image
                    </Button>
                  ) : null}
                  {avatarUrl ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          type="button"
                          aria-label="Remove image"
                          disabled={isSaving}
                          onClick={() => {
                            setAvatarDataUrl(null)
                            setDeleteAvatar(true)
                            setGeneralErrors((current) => ({
                              ...current,
                              avatarDataUrl: undefined,
                            }))
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove image</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <FieldError id="project-avatar-error">
                  {generalErrors.avatarDataUrl}
                </FieldError>
                {isReadingAvatar ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Reading image…
                  </p>
                ) : null}
              </Field>

              <Field data-invalid={Boolean(generalErrors['projectName'])}>
                <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                <Input
                  id="project-name"
                  required
                  maxLength={100}
                  aria-invalid={Boolean(generalErrors['projectName'])}
                  aria-describedby="project-name-error"
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value)
                    setGeneralErrors((current) => ({
                      ...current,
                      projectName: undefined,
                    }))
                  }}
                />
                <FieldError id="project-name-error">
                  {generalErrors['projectName']}
                </FieldError>
              </Field>
              <Field>
                <FieldLabel>Git repository</FieldLabel>
                <div className="flex items-center">
                  <RepositoryPickerDialog
                    teamSlug={
                      typeof params.teamSlug === 'string' ? params.teamSlug : ''
                    }
                    currentRepo={selectedRepo}
                    onSelect={(repo) => {
                      setSelectedRepo(repo)
                      setGeneralErrors((current) => ({
                        ...current,
                        repoFullName: undefined,
                      }))
                    }}
                  >
                    <Button
                      variant="outline"
                      type="button"
                      id="project-repository"
                      aria-invalid={Boolean(generalErrors.repoFullName)}
                      aria-describedby="project-repository-error"
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
              <FieldError id="project-repository-error">
                {generalErrors.repoFullName}
              </FieldError>
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
                    <CopyButton
                      value={project.id}
                      label="Copy project ID"
                      inputGroup
                    />
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  A unique identifier used in API, environment variables, etc.
                </FieldDescription>
              </Field>
            </fieldset>
          </form>
        </SettingsSection>

        <SettingsSection
          id="build-and-deploy"
          title="Build & Deploy"
          description="Configure the Compose file, deployment commands, and health checks."
          footer={
            <SettingsActions
              form="project-build-form"
              hasChanges={hasBuildChanges}
              isSaving={isSaving}
              onCancel={resetBuildSettings}
              onSave={saveBuildSettings}
            />
          }
        >
          <form
            id="project-build-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveBuildSettings()
            }}
          >
            <fieldset disabled={isSaving} className="space-y-4">
              <FieldGroup>
                <Field
                  data-invalid={Boolean(buildErrors['runtimeConfig.path'])}
                >
                  <FieldLabel htmlFor="compose-path">
                    Compose file path
                  </FieldLabel>
                  <Input
                    id="compose-path"
                    maxLength={255}
                    aria-invalid={Boolean(buildErrors['runtimeConfig.path'])}
                    aria-describedby="compose-path-error"
                    placeholder="compose.yml"
                    value={composePath}
                    onChange={(event) => {
                      setComposePath(event.target.value)
                      setBuildErrors((current) => ({
                        ...current,
                        'runtimeConfig.path': undefined,
                      }))
                    }}
                  />
                  <FieldError id="compose-path-error">
                    {buildErrors['runtimeConfig.path']}
                  </FieldError>
                  <FieldDescription>
                    Repository-relative path to the Compose file. Defaults to
                    compose.yml.
                  </FieldDescription>
                </Field>
                <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)]">
                  <Field
                    data-invalid={Boolean(
                      buildErrors['runtimeConfig.releaseCommand'],
                    )}
                  >
                    <FieldLabel htmlFor="release-command">
                      Pre-deploy command
                    </FieldLabel>
                    <Textarea
                      id="release-command"
                      maxLength={16384}
                      aria-invalid={Boolean(
                        buildErrors['runtimeConfig.releaseCommand'],
                      )}
                      aria-describedby="release-command-error"
                      className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
                      rows={1}
                      value={releaseCommand}
                      onChange={(event) => {
                        setReleaseCommand(event.target.value)
                        setBuildErrors((current) => ({
                          ...current,
                          'runtimeConfig.releaseCommand': undefined,
                        }))
                      }}
                    />
                    <FieldError id="release-command-error">
                      {buildErrors['runtimeConfig.releaseCommand']}
                    </FieldError>
                    <FieldDescription>
                      Runs once before services are updated. For example,{' '}
                      <code>php artisan migrate --force</code>. Leave empty to
                      skip.
                    </FieldDescription>
                  </Field>
                  <Field
                    data-invalid={Boolean(
                      buildErrors['runtimeConfig.releaseService'],
                    )}
                  >
                    <FieldLabel htmlFor="release-service">
                      Pre-deploy service
                    </FieldLabel>
                    <Input
                      id="release-service"
                      aria-invalid={Boolean(
                        buildErrors['runtimeConfig.releaseService'],
                      )}
                      aria-describedby="release-service-error"
                      value={releaseService}
                      placeholder={
                        defaultReleaseService
                          ? `Default (${defaultReleaseService})`
                          : 'Select a service'
                      }
                      onChange={(event) => {
                        setReleaseService(event.target.value)
                        setBuildErrors((current) => ({
                          ...current,
                          'runtimeConfig.releaseService': undefined,
                        }))
                      }}
                    />
                    <FieldError id="release-service-error">
                      {buildErrors['runtimeConfig.releaseService']}
                    </FieldError>
                    <FieldDescription>
                      Service to run the pre-deploy command.
                    </FieldDescription>
                  </Field>
                </div>
                <Field
                  data-invalid={Boolean(
                    buildErrors['runtimeConfig.deployCommand'],
                  )}
                >
                  <FieldLabel htmlFor="deploy-command">
                    Deploy command
                  </FieldLabel>
                  <Textarea
                    id="deploy-command"
                    maxLength={16384}
                    aria-invalid={Boolean(
                      buildErrors['runtimeConfig.deployCommand'],
                    )}
                    aria-describedby="deploy-command-error"
                    className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
                    rows={1}
                    disabled={!canManageLifecycleCommands}
                    value={deployCommand}
                    placeholder={managedComposeCommand}
                    onChange={(event) => {
                      setDeployCommand(event.target.value)
                      setBuildErrors((current) => ({
                        ...current,
                        'runtimeConfig.deployCommand': undefined,
                      }))
                    }}
                  />
                  <FieldError id="deploy-command-error">
                    {buildErrors['runtimeConfig.deployCommand']}
                  </FieldError>
                  <FieldDescription>
                    Runs on the server to update services after images and the
                    pre-deploy command are ready. When empty, uses{' '}
                    <code>{managedComposeCommand}</code>.
                  </FieldDescription>
                </Field>
                <Field
                  data-invalid={Boolean(
                    buildErrors['runtimeConfig.rollbackCommand'],
                  )}
                >
                  <FieldLabel htmlFor="rollback-command">
                    Rollback command
                  </FieldLabel>
                  <Textarea
                    id="rollback-command"
                    maxLength={16384}
                    aria-invalid={Boolean(
                      buildErrors['runtimeConfig.rollbackCommand'],
                    )}
                    aria-describedby="rollback-command-error"
                    className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
                    rows={1}
                    disabled={!canManageLifecycleCommands}
                    value={rollbackCommand}
                    placeholder={deployCommand.trim() || managedComposeCommand}
                    onChange={(event) => {
                      setRollbackCommand(event.target.value)
                      setBuildErrors((current) => ({
                        ...current,
                        'runtimeConfig.rollbackCommand': undefined,
                      }))
                    }}
                  />
                  <FieldError id="rollback-command-error">
                    {buildErrors['runtimeConfig.rollbackCommand']}
                  </FieldError>
                  <FieldDescription>
                    Runs on the server when deploying a previous revision. When
                    empty, uses the deploy command.
                  </FieldDescription>
                </Field>
                <Field
                  data-invalid={Boolean(
                    buildErrors['runtimeConfig.timeoutSeconds'],
                  )}
                >
                  <FieldLabel htmlFor="deploy-timeout">
                    Command timeout
                  </FieldLabel>
                  <Input
                    id="deploy-timeout"
                    aria-invalid={Boolean(
                      buildErrors['runtimeConfig.timeoutSeconds'],
                    )}
                    aria-describedby="deploy-timeout-error"
                    type="number"
                    min={60}
                    max={7200}
                    step={1}
                    required
                    value={deployTimeoutSeconds}
                    onChange={(event) => {
                      setDeployTimeoutSeconds(event.target.value)
                      setBuildErrors((current) => ({
                        ...current,
                        'runtimeConfig.timeoutSeconds': undefined,
                      }))
                    }}
                  />
                  <FieldError id="deploy-timeout-error">
                    {buildErrors['runtimeConfig.timeoutSeconds']}
                  </FieldError>
                  <FieldDescription>
                    Maximum runtime for either command: 60–7,200 seconds.
                  </FieldDescription>
                </Field>
                <Field
                  data-invalid={Boolean(
                    buildErrors['runtimeConfig.readinessPath'],
                  )}
                >
                  <FieldLabel htmlFor="readiness">Health check path</FieldLabel>
                  <Input
                    id="readiness"
                    aria-invalid={Boolean(
                      buildErrors['runtimeConfig.readinessPath'],
                    )}
                    aria-describedby="readiness-error"
                    value={readinessPath}
                    placeholder="/"
                    onChange={(event) => {
                      setReadinessPath(event.target.value)
                      setBuildErrors((current) => ({
                        ...current,
                        'runtimeConfig.readinessPath': undefined,
                      }))
                    }}
                  />
                  <FieldError id="readiness-error">
                    {buildErrors['runtimeConfig.readinessPath']}
                  </FieldError>
                  <FieldDescription>
                    Path requested after deployment to confirm the service is
                    ready.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </fieldset>
          </form>
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
              isSaving={isSaving || verifyingDomainId !== null}
              onCancel={resetRoutes}
              onSave={saveRoutes}
              form="project-routes-form"
            />
          }
        >
          <form
            id="project-routes-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveRoutes()
            }}
          >
            <fieldset
              disabled={isSaving || verifyingDomainId !== null}
              className="space-y-4"
            >
              <ManagedIngressWarnings
                warnings={context.composeMetadata?.warnings ?? []}
              />
              <RouteSettingsTable
                services={context.composeMetadata?.services ?? []}
                routes={routes}
                environments={context.environments}
                errors={routeErrors}
                onChange={(next) => {
                  setRoutes(next)
                  setRouteErrors({})
                }}
              />
            </fieldset>
          </form>
        </SettingsSection>

        <SettingsSection
          id="domains"
          title="Domains"
          description="Custom domain names associated with this project's environments."
          footer={
            <SettingsActions
              hasChanges={hasDomainChanges}
              isSaving={isSaving || verifyingDomainId !== null}
              onCancel={resetDomains}
              onSave={saveDomains}
              form="project-domains-form"
            />
          }
        >
          <form
            id="project-domains-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveDomains()
            }}
          >
            <fieldset
              disabled={isSaving || verifyingDomainId !== null}
              className="space-y-4"
            >
              <DomainSettingsTable
                servers={context.servers}
                domains={domains}
                environments={context.environments}
                routes={savedRoutes}
                errors={domainErrors}
                onChange={(next) => {
                  setDomains(next)
                  setDomainErrors({})
                }}
                onVerify={verifyDomain}
                verifyingDomainId={verifyingDomainId}
                verificationDisabled={hasDomainChanges || isSaving}
              />
            </fieldset>
          </form>
        </SettingsSection>

        <NotificationMute scope={{ kind: 'project', id: project.id }} />
        <SettingsSection
          id="danger"
          title="Danger"
          description="Permanently delete the project and all of its configuration, environments and deployments."
        >
          {context.team.role === 'owner' || context.team.role === 'admin' ? (
            <AlertDialog
              open={deleteOpen}
              onOpenChange={(next) => {
                if (!isDeletingProject && !projectDeleted) {
                  setDeleteOpen(next)
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={isDeletingProject || projectDeleted}
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
                  <Field
                    orientation="horizontal"
                    className="rounded-md border p-3"
                  >
                    <Checkbox
                      id="delete-project-remove-deployments"
                      disabled={isDeletingProject}
                      checked={removeProjectDeployments}
                      onCheckedChange={(checked) =>
                        setRemoveProjectDeployments(checked === true)
                      }
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="delete-project-remove-deployments">
                        Remove deployed Docker Compose runtimes
                      </FieldLabel>
                      <FieldDescription>
                        Persistent volumes are retained for 7 days. If
                        unchecked, deployments may keep running on connected
                        servers, but devpush will stop managing them. Their
                        hostnames remain reserved.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field>
                    <Input
                      aria-label={`Type ${project.name} to confirm`}
                      id="delete-project-confirmation"
                      required
                      disabled={isDeletingProject}
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
                  <AlertDialogCancel
                    disabled={isDeletingProject || projectDeleted}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={
                      isDeletingProject ||
                      projectDeleted ||
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
      </SettingsLayout>
    </div>
  )
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

const projectSettingsFieldIds: Record<string, string> = {
  projectName: 'project-name',
  'runtimeConfig.path': 'compose-path',
  'runtimeConfig.releaseCommand': 'release-command',
  'runtimeConfig.releaseService': 'release-service',
  'runtimeConfig.deployCommand': 'deploy-command',
  'runtimeConfig.rollbackCommand': 'rollback-command',
  'runtimeConfig.timeoutSeconds': 'deploy-timeout',
  'runtimeConfig.readinessPath': 'readiness',
  avatarDataUrl: 'project-avatar-button',
  repoFullName: 'project-repository',
}
