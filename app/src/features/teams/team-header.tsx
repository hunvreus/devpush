import { mutationErrorOptions, afterMutation  } from '#devpush/lib/action-feedback'
import { WorkspacePluginContributions } from '#devpush/features/plugins/contributions'
import { LogoMark } from '#devpush/components/logo-mark'
import { invalidateResourceQueries } from '#devpush/lib/resource-cache'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#devpush/components/ui/dialog'
import { AboutDialog } from '#devpush/components/about-dialog'
import { NewTeamDialogLauncher } from './new-team-dialog'
import { SignOutMenuItem } from '#devpush/features/auth/sign-out-menu-item'
import {
  Link,
  useParams,
  useHydrated,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pluginContextQueryOptions } from '#devpush/lib/project-context-query'
import { useTheme } from 'next-themes'
import {
  ArrowUpRightIcon,
  BellIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  LoaderIcon,
  MoonIcon,
  SunIcon,
  CircleAlertIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getCachedTeamContexts } from '#devpush/lib/team-context-query'

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '#devpush/components/ui/avatar'
import { ResourceAvatar } from '#devpush/components/resource-avatar'
import { Button } from '#devpush/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import { Skeleton } from '#devpush/components/ui/skeleton'
import { NewProjectDialogLauncher } from '#devpush/features/repositories/new-project-dialog-launcher'
import { getServerAvailabilityNotice } from '#devpush/features/servers/server-availability'
import { ServerAvailabilityAlert } from '#devpush/features/servers/server-availability-alert'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { displayNameFromSlug } from '#devpush/lib/display-name'
import { cn } from '#devpush/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#devpush/components/ui/dropdown-menu'
import type { AuthUserContext } from '#devpush/server/auth/context'
import type { ProjectContext } from '#devpush/server/projects/types'
import type {
  ProjectSummary,
  ServerSummary,
  TeamSummary,
} from '#devpush/server/teams/types'
import {
  acceptUserTeamInviteAction,
  declineUserTeamInviteAction,
} from '#devpush/server/teams/functions'
import {
  isProjectTabActive,
  isTeamTabActive,
  projectTabs,
  teamTabs,
} from './navigation'

type ProjectNavigationSummary = Pick<
  ProjectSummary,
  'avatarUrl' | 'color' | 'id' | 'name'
>

type TeamHeaderProps = {
  currentProject?: boolean
  currentProjectContext?: ProjectNavigationSummary
  currentProjects?: Array<ProjectNavigationSummary>
  currentDeployment?: {
    id: string
    status: ProjectContext['deployments'][number]['status']
  }
  currentDeployments?: ProjectContext['deployments']
  userContext?: AuthUserContext
  currentTeam?: TeamSummary
}

function TeamHeader({
  currentProject = false,
  currentProjectContext,
  currentProjects = [],
  currentDeployment,
  currentDeployments = [],
  userContext,
  currentTeam,
}: TeamHeaderProps) {
  const queryClient = useQueryClient()
  const pathname = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  const params = useParams({ strict: false })
  const teamSlug =
    typeof params.teamSlug === 'string'
      ? params.teamSlug
      : (currentTeam?.slug ?? userContext?.defaultTeam.slug ?? '')
  const hydrated = useHydrated()
  // A client loader can populate the cache before hydration finishes. Keep the
  // first client header identical to SSR, then reveal cached navigation.
  const cachedTeamContexts = hydrated
    ? getCachedTeamContexts(queryClient, teamSlug)
    : []
  const cachedTeamContext = cachedTeamContexts.at(0)
  const activeUserContext = userContext ?? cachedTeamContext?.userContext
  const activeTeam =
    currentTeam ?? cachedTeamContext?.team ?? activeUserContext?.defaultTeam
  const routeProjectName =
    typeof params.projectName === 'string' ? params.projectName : undefined
  const routeDeploymentId =
    typeof params.deploymentId === 'string' ? params.deploymentId : undefined
  // Observe the detail route's query so both the current status and menu rows
  // receive the same workspace notifications, without a second request.
  const { data: pluginContext } = useQuery({
    ...pluginContextQueryOptions(
      {
        teamSlug,
        projectName: routeProjectName ?? '',
        deploymentId: routeDeploymentId ?? '',
      },
      queryClient,
    ),
    enabled: false,
  })
  const activeDeployment =
    currentDeployment ??
    (hydrated ? pluginContext?.deployment : undefined) ??
    (routeDeploymentId
      ? { id: routeDeploymentId, status: undefined }
      : undefined)
  const activeDeployments =
    hydrated && pluginContext
      ? pluginContext.latestDeployments
      : currentDeployments
  const cachedProject = routeProjectName
    ? cachedTeamContexts
        .flatMap((context) => context.projects)
        .find((project) => project.name === routeProjectName)
    : undefined
  const activeProject = currentProjectContext ?? cachedProject
  const activeProjects =
    currentProjects.length > 0
      ? currentProjects
      : cachedTeamContexts.flatMap((context) => context.projects)
  const tabs = currentProject ? projectTabs : teamTabs

  return (
    <header className="sticky top-0 z-20 flex flex-col gap-y-2 border-b bg-background px-3 sm:px-8">
      <div className="flex h-16 min-w-0 items-center justify-between gap-x-2 sm:gap-x-4">
        <nav className="flex min-w-0 flex-1 items-center gap-x-0.5 sm:gap-x-1.5">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className={cn(
              'group mr-1 shrink-0',
              currentProject && 'max-sm:hidden',
            )}
          >
            <Link to="/" aria-label="devpush">
              <LogoMark className="size-4.5 shrink-0 transition-colors duration-200 group-hover:text-orange-600 group-focus-visible:text-orange-600" />
            </Link>
          </Button>
          <span
            className={cn(
              'shrink-0 text-xl text-muted-foreground/25',
              currentProject && 'max-sm:hidden',
            )}
          >
            /
          </span>
          {activeTeam && activeUserContext ? (
            <TeamSwitcher
              currentTeam={activeTeam}
              teams={activeUserContext.teams}
              collapsed={currentProject}
            />
          ) : (
            <PendingResourceSwitcher
              label={displayNameFromSlug(teamSlug)}
              name={teamSlug}
              ariaLabel="Team loading"
              collapsed={currentProject}
              teamSlug={teamSlug}
            />
          )}
          {currentProject ? (
            <>
              <span className="shrink-0 text-xl text-muted-foreground/25">
                /
              </span>
              {activeProject ? (
                <ProjectSwitcher
                  teamSlug={teamSlug}
                  project={activeProject}
                  projects={activeProjects}
                  collapsed={Boolean(activeDeployment)}
                />
              ) : (
                <PendingResourceSwitcher
                  label={
                    typeof params.projectName === 'string'
                      ? params.projectName
                      : 'Project'
                  }
                  name={
                    typeof params.projectName === 'string'
                      ? params.projectName
                      : 'Project'
                  }
                  ariaLabel="Project loading"
                  collapsed={Boolean(activeDeployment)}
                  teamSlug={teamSlug}
                  projectName={
                    typeof params.projectName === 'string'
                      ? params.projectName
                      : 'project'
                  }
                />
              )}
            </>
          ) : null}
          {activeDeployment ? (
            <>
              <span className="shrink-0 text-xl text-muted-foreground/25">
                /
              </span>
              <DeploymentSwitcher
                deployment={activeDeployment}
                deployments={activeDeployments}
                projectName={
                  typeof params.projectName === 'string'
                    ? params.projectName
                    : (currentProjectContext?.name ?? '')
                }
                teamSlug={teamSlug}
              />
            </>
          ) : null}
          {activeTeam && activeTeam.slug === teamSlug ? (
            <>
              <WorkspacePluginContributions
                place="header"
                teamSlug={teamSlug}
                role={activeTeam.role}
              />
            </>
          ) : null}
        </nav>

        <nav
          className="flex shrink-0 items-center gap-2"
          aria-label="User menu"
        >
          {activeUserContext ? (
            <UserMenu userContext={activeUserContext} />
          ) : (
            <PendingUserNavigation />
          )}
        </nav>
      </div>

      <nav
        className="scrollbar -mt-2 -mb-[1px] overflow-x-auto"
        aria-label="Secondary navigation"
      >
        <ul
          className="flex w-max min-w-full items-center gap-x-1"
          role="tablist"
        >
          {tabs.map((tab) => {
            const active = currentProject
              ? isProjectTabActive(pathname, tab.label)
              : isTeamTabActive(pathname, tab.label)
            const tabParams = currentProject
              ? {
                  teamSlug,
                  projectName:
                    typeof params.projectName === 'string'
                      ? params.projectName
                      : (currentProjectContext?.name ?? ''),
                }
              : { teamSlug }

            return (
              <li
                key={tab.label}
                role="presentation"
                className={`shrink-0 border-b-2 pb-1.5 ${
                  active ? 'border-primary' : 'border-transparent'
                }`}
              >
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className={
                    active ? ' text-foreground' : ' text-muted-foreground'
                  }
                >
                  <Link
                    to={tab.to}
                    params={tabParams}
                    activeOptions={{ exact: tab.label === 'Overview' }}
                    aria-selected={active}
                    role="tab"
                  >
                    {tab.label}
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      </nav>
    </header>
  )
}

export function TeamPage({
  children,
  contentClassName,
  userContext,
  currentTeam,
  currentProject,
  currentProjects = [],
  projectNavigation = false,
  pending = false,
  servers = [],
}: {
  children: ReactNode
  contentClassName?: string
  userContext?: AuthUserContext
  currentTeam?: TeamSummary
  currentProject?: ProjectNavigationSummary
  currentProjects?: Array<ProjectNavigationSummary>
  projectNavigation?: boolean
  pending?: boolean
  servers?: Array<ServerSummary>
}) {
  const serverNotice = getServerAvailabilityNotice(servers)
  const queryClient = useQueryClient()
  const params = useParams({ strict: false })
  const hydrated = useHydrated()
  const teamSlug =
    typeof params.teamSlug === 'string'
      ? params.teamSlug
      : (currentTeam?.slug ?? '')
  const noticeTeam =
    currentTeam ??
    (hydrated
      ? getCachedTeamContexts(queryClient, teamSlug).at(0)?.team
      : undefined)

  return (
    <main className="min-h-screen min-w-0 bg-background text-foreground">
      <TeamHeader
        currentProject={projectNavigation || Boolean(currentProject)}
        currentProjectContext={currentProject}
        currentProjects={currentProjects}
        userContext={userContext}
        currentTeam={currentTeam}
      />
      <div
        className={cn(
          'mx-auto w-full min-w-0 max-w-screen-xl p-4 sm:p-8',
          contentClassName,
        )}
        aria-busy={pending || undefined}
      >
        {noticeTeam ? (
          <>
            <WorkspacePluginContributions
              place="notice"
              teamSlug={noticeTeam.slug}
              role={noticeTeam.role}
            />
          </>
        ) : null}
        {serverNotice && currentTeam && !currentProject ? (
          <ServerAvailabilityAlert notice={serverNotice} team={currentTeam} />
        ) : null}
        {children}
      </div>
    </main>
  )
}

function PendingResourceSwitcher({
  collapsed = false,
  ariaLabel,
  label,
  name,
  projectName,
  teamSlug,
}: {
  collapsed?: boolean
  ariaLabel: string
  label: string
  name: string
  projectName?: string
  teamSlug: string
}) {
  const content = (
    <>
      <ResourceAvatar data-icon="inline-start" name={name} size="xs" />
      <span className={cn('max-w-48 truncate', collapsed && 'max-sm:hidden')}>
        {label}
      </span>
    </>
  )

  return (
    <div
      className={cn(
        'flex min-w-0 items-center',
        collapsed ? 'max-sm:shrink-0' : 'flex-1 sm:flex-initial',
      )}
      aria-label={ariaLabel}
    >
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="min-w-0 shrink gap-1.5 px-1 max-sm:gap-1 sm:px-1.5"
      >
        {projectName ? (
          <Link
            to="/$teamSlug/projects/$projectName"
            params={{ teamSlug, projectName }}
          >
            {content}
          </Link>
        ) : (
          <Link to="/$teamSlug" params={{ teamSlug }}>
            {content}
          </Link>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-events-none shrink-0 text-muted-foreground max-sm:size-5"
        aria-hidden="true"
        tabIndex={-1}
      >
        <ChevronsUpDownIcon />
      </Button>
    </div>
  )
}

function PendingUserNavigation() {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Notifications loading"
        disabled
      >
        <BellIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="relative rounded-full border-0"
        aria-label="User menu loading"
        aria-busy="true"
        disabled
      >
        <Skeleton className="size-6 shrink-0 rounded-full" />
      </Button>
    </>
  )
}

function TeamSwitcher({
  collapsed = false,
  currentTeam,
  teams,
}: {
  collapsed?: boolean
  currentTeam: TeamSummary
  teams: Array<TeamSummary>
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return (
    <div
      className={cn(
        'flex min-w-0 items-center',
        collapsed ? 'max-sm:shrink-0' : 'flex-1 sm:flex-initial',
      )}
    >
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="min-w-0 shrink gap-1.5 px-1 max-sm:gap-1 sm:px-1.5"
      >
        <Link
          to="/$teamSlug"
          params={{ teamSlug: currentTeam.slug }}
          aria-label={currentTeam.name}
        >
          <ResourceAvatar
            data-icon="inline-start"
            name={currentTeam.name}
            src={currentTeam.image ?? undefined}
            color={currentTeam.color}
            size="xs"
          />
          <span
            className={cn('max-w-48 truncate', collapsed && 'max-sm:hidden')}
          >
            {currentTeam.name}
          </span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground max-sm:size-5"
            aria-label="Switch team"
          >
            <ChevronsUpDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          className="w-auto max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuItem className="gap-1.5 whitespace-nowrap">
            <ResourceAvatar
              name={currentTeam.name}
              src={currentTeam.image ?? undefined}
              color={currentTeam.color}
              size="xs"
            />
            <span className="min-w-0 truncate">{currentTeam.name}</span>
            <CheckIcon className="ml-auto text-muted-foreground" />
          </DropdownMenuItem>
          {teams
            .filter((teamOption) => teamOption.id !== currentTeam.id)
            .slice(0, 5)
            .map((teamOption) => (
              <DropdownMenuItem
                asChild
                className="gap-1.5 whitespace-nowrap"
                key={teamOption.id}
              >
                <Link to="/$teamSlug" params={{ teamSlug: teamOption.slug }}>
                  <ResourceAvatar
                    name={teamOption.name}
                    src={teamOption.image ?? undefined}
                    color={teamOption.color}
                    size="xs"
                  />
                  <span className="min-w-0 truncate">{teamOption.name}</span>
                  <span className="ml-auto size-4" />
                </Link>
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <NewTeamDialogLauncher
            onCreated={async (teamSlug) => {
              await afterMutation(
                () => invalidateResourceQueries(queryClient),
                'The action completed, but refreshing the data failed. Please reload.',
              )
              await afterMutation(
                () => router.invalidate(),
                'The action completed, but refreshing the page failed. Please reload.',
              )
              await afterMutation(
                () =>
                  router.navigate({
                    to: '/$teamSlug',
                    params: { teamSlug },
                  }),
                'The action completed, but opening the next page failed. Please reload.',
              )
            }}
          >
            {(open) => (
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={(event) => {
                  event.preventDefault()
                  open()
                }}
              >
                Add new team
              </DropdownMenuItem>
            )}
          </NewTeamDialogLauncher>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ProjectSwitcher({
  collapsed = false,
  teamSlug,
  project,
  projects,
}: {
  collapsed?: boolean
  teamSlug: string
  project: ProjectNavigationSummary
  projects: Array<ProjectNavigationSummary>
}) {
  const params = useParams({ strict: false })
  const projectName =
    typeof params.projectName === 'string' ? params.projectName : project.name

  return (
    <div
      className={cn(
        'flex min-w-0 items-center',
        collapsed ? 'max-sm:shrink-0' : 'flex-1 sm:flex-initial',
      )}
    >
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="min-w-0 shrink gap-1.5 px-1 max-sm:gap-1 sm:px-1.5"
      >
        <Link
          to="/$teamSlug/projects/$projectName"
          params={{ teamSlug, projectName }}
          aria-label={project.name}
        >
          <ResourceAvatar
            data-icon="inline-start"
            name={project.name}
            src={project.avatarUrl ?? undefined}
            color={project.color}
            size="xs"
          />
          <span
            className={cn('max-w-48 truncate', collapsed && 'max-sm:hidden')}
          >
            {project.name}
          </span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground max-sm:size-5"
            aria-label="Switch project"
          >
            <ChevronsUpDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          className="w-auto max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuItem asChild className="gap-1.5 whitespace-nowrap">
            <Link
              to="/$teamSlug/projects/$projectName"
              params={{ teamSlug, projectName }}
            >
              <ResourceAvatar
                name={project.name}
                src={project.avatarUrl ?? undefined}
                color={project.color}
                size="xs"
              />
              <span className="min-w-0 truncate">{project.name}</span>
              <CheckIcon className="ml-auto" />
            </Link>
          </DropdownMenuItem>
          {projects
            .filter((projectOption) => projectOption.id !== project.id)
            .slice(0, 5)
            .map((projectOption) => (
              <DropdownMenuItem
                asChild
                className="gap-1.5 whitespace-nowrap"
                key={projectOption.id}
              >
                <Link
                  to="/$teamSlug/projects/$projectName"
                  params={{ teamSlug, projectName: projectOption.name }}
                >
                  <ResourceAvatar
                    name={projectOption.name}
                    src={projectOption.avatarUrl ?? undefined}
                    color={projectOption.color}
                    size="xs"
                  />
                  <span className="min-w-0 truncate">{projectOption.name}</span>
                  <span className="ml-auto size-4" />
                </Link>
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <NewProjectDialogLauncher teamSlug={teamSlug}>
            {(open) => (
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={(event) => {
                  event.preventDefault()
                  open()
                }}
              >
                Add new project
              </DropdownMenuItem>
            )}
          </NewProjectDialogLauncher>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DeploymentSwitcher({
  deployment,
  deployments,
  projectName,
  teamSlug,
}: {
  deployment: {
    id: string
    status?: ProjectContext['deployments'][number]['status']
  }
  deployments: ProjectContext['deployments']
  projectName: string
  teamSlug: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center sm:flex-initial">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="min-w-0 shrink px-1 sm:px-1.5"
      >
        <Link
          to="/$teamSlug/projects/$projectName/deployments/$deploymentId"
          params={{ teamSlug, projectName, deploymentId: deployment.id }}
          aria-label={`Deployment ${shortId(deployment.id)}: ${deployment.status ?? 'loading'}`}
        >
          <DeploymentStatusIcon
            data-icon="inline-start"
            status={deployment.status}
          />
          <span className="truncate font-mono text-[13px]">
            {shortId(deployment.id)}
          </span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground max-sm:size-5"
            aria-label="Switch deployment"
            disabled={deployment.status === undefined}
          >
            <ChevronsUpDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          className="w-auto max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuItem className="gap-x-2 whitespace-nowrap">
            <DeploymentStatusIcon status={deployment.status} />
            <span className="font-mono text-[13px]">
              {shortId(deployment.id)}
            </span>
            <CheckIcon className="ml-auto" />
          </DropdownMenuItem>
          {deployments
            .filter((deploymentOption) => deploymentOption.id !== deployment.id)
            .slice(0, 5)
            .map((deploymentOption) => (
              <DropdownMenuItem
                asChild
                className="gap-x-2 whitespace-nowrap"
                key={deploymentOption.id}
              >
                <Link
                  to="/$teamSlug/projects/$projectName/deployments/$deploymentId"
                  params={{
                    teamSlug,
                    projectName,
                    deploymentId: deploymentOption.id,
                  }}
                  aria-label={`Deployment ${shortId(deploymentOption.id)}: ${deploymentOption.status}`}
                >
                  <DeploymentStatusIcon status={deploymentOption.status} />
                  <span className="font-mono text-[13px]">
                    {shortId(deploymentOption.id)}
                  </span>
                  <span className="ml-auto size-4" />
                </Link>
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="whitespace-nowrap">
            <Link
              to="/$teamSlug/projects/$projectName/deployments"
              params={{ teamSlug, projectName }}
            >
              All deployments
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function NotificationsMenu({
  invites,
}: {
  invites: AuthUserContext['invites']
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [selectedInvite, setSelectedInvite] = useState<
    AuthUserContext['invites'][number] | null
  >(null)
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [busyInviteAction, setBusyInviteAction] = useState<
    'accept' | 'decline' | null
  >(null)
  const invitationLabel =
    invites.length === 1 ? '1 team invitation' : `${invites.length} invitations`

  async function acceptInvite() {
    if (!selectedInvite || busyInviteId) {
      return
    }

    setBusyInviteId(selectedInvite.id)
    setBusyInviteAction('accept')

    try {
      const teamSlug = await acceptUserTeamInviteAction({
        data: { inviteId: selectedInvite.id },
      })
      toast.success('Invitation accepted.')
      setSelectedInvite(null)
      await afterMutation(
        () => invalidateResourceQueries(queryClient),
        'The action completed, but refreshing the data failed. Please reload.',
      )
      await afterMutation(
        () => router.invalidate(),
        'The action completed, but refreshing the page failed. Please reload.',
      )
      await afterMutation(
        () => router.navigate({ to: '/$teamSlug', params: { teamSlug } }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      toast.error(
        getPublicErrorMessage(error, 'Unable to accept invitation.'),
        ...mutationErrorOptions(error),
      )
    } finally {
      setBusyInviteId(null)
      setBusyInviteAction(null)
    }
  }

  async function declineInvite() {
    if (!selectedInvite || busyInviteId) return
    setBusyInviteId(selectedInvite.id)
    setBusyInviteAction('decline')
    try {
      await declineUserTeamInviteAction({
        data: { inviteId: selectedInvite.id },
      })
      toast.success('Invitation declined.')
      setSelectedInvite(null)
      await afterMutation(async () => {
        await invalidateResourceQueries(queryClient)
        await router.invalidate()
      }, 'Invitation declined, but refreshing the page failed. Please reload.')
    } catch (error) {
      toast.error(
        getPublicErrorMessage(error, 'Unable to decline invitation.'),
        ...mutationErrorOptions(error),
      )
    } finally {
      setBusyInviteId(null)
      setBusyInviteAction(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative"
                aria-label="Notifications"
                aria-description={
                  invites.length > 0 ? invitationLabel : undefined
                }
              >
                <BellIcon />
                {invites.length > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive ring-2 ring-background"
                  />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="w-72 max-w-[calc(100vw-2rem)]"
        >
          {invites.length === 0 ? (
            <p className="flex items-center justify-center px-2 py-1.5 text-sm text-muted-foreground">
              No new notifications
            </p>
          ) : (
            <>
              <DropdownMenuLabel>{invitationLabel}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {invites.map((invite) => (
                <DropdownMenuItem
                  key={invite.id}
                  className="whitespace-normal"
                  onSelect={() => setSelectedInvite(invite)}
                >
                  <span className="flex min-w-0 max-w-64 flex-col gap-1 text-left">
                    <span className="flex min-w-0 items-center gap-2">
                      <ResourceAvatar
                        name={invite.team.name}
                        src={invite.team.image ?? undefined}
                        color={invite.team.color}
                        size="xs"
                      />
                      <span className="truncate">{invite.team.name}</span>
                    </span>
                    <span className="truncate pl-7 text-muted-foreground">
                      <time dateTime={invite.createdAt}>
                        {formatInviteAge(invite.createdAt)}
                      </time>
                      {invite.inviter
                        ? ` by ${invite.inviter.name || invite.inviter.email}`
                        : ''}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={selectedInvite !== null}
        onOpenChange={(open) => {
          if (!open && !busyInviteId) {
            setSelectedInvite(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedInvite
                ? `Invitation to "${selectedInvite.team.name}"`
                : 'Team invitation'}
            </DialogTitle>
            {selectedInvite ? (
              <DialogDescription>
                {selectedInvite.inviter ? (
                  <>
                    <strong className="font-medium">
                      {selectedInvite.inviter.name ||
                        selectedInvite.inviter.email}
                    </strong>{' '}
                    invited you
                  </>
                ) : (
                  'You have been invited'
                )}{' '}
                to join the "
                <strong className="font-medium">
                  {selectedInvite.team.name}
                </strong>
                " team. This invitation will expire on{' '}
                <strong className="font-medium">
                  {formatInvitationExpiry(selectedInvite.expiresAt)}
                </strong>
                .
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {selectedInvite ? (
            <dl className="divide-y rounded-lg border text-sm">
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 px-4 py-2">
                <dt className="text-muted-foreground">Team</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <ResourceAvatar
                    name={selectedInvite.team.name}
                    src={selectedInvite.team.image ?? undefined}
                    color={selectedInvite.team.color}
                    size="xs"
                  />
                  <span className="min-w-0 truncate">
                    {selectedInvite.team.name}
                  </span>
                </dd>
              </div>
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 px-4 py-2">
                <dt className="text-muted-foreground">Role</dt>
                <dd>{selectedInvite.role === 'admin' ? 'Admin' : 'Member'}</dd>
              </div>
            </dl>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyInviteId !== null}
              onClick={() => void declineInvite()}
            >
              {busyInviteAction === 'decline' ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Decline invitation
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busyInviteId !== null}
              onClick={() => setSelectedInvite(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busyInviteId !== null}
              onClick={acceptInvite}
            >
              {busyInviteAction === 'accept' ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Accept invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function UserMenu({ userContext }: { userContext: AuthUserContext }) {
  const [aboutOpen, setAboutOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const { user } = userContext
  const label = user.name || user.email
  const initial = label.trim().charAt(0).toLocaleUpperCase() || '?'

  return (
    <>
      <NotificationsMenu invites={userContext.invites} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative rounded-full border-0"
            aria-label="User menu"
          >
            <Avatar className="size-6">
              {user.image ? (
                <AvatarImage
                  src={user.image}
                  alt={user.email}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-auto max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuLabel className="px-2.5 py-1.5 text-sm text-foreground">
            <span className="block max-w-64 truncate font-medium">{label}</span>
            <span className="block max-w-64 truncate text-muted-foreground">
              {user.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {user.isInstallationAdmin ? (
            <DropdownMenuItem asChild>
              <Link
                to="/admin"
                search={{
                  allowlistQuery: '',
                  allowlistPage: 1,
                  userQuery: '',
                  userPage: 1,
                }}
              >
                Admin
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild className="whitespace-nowrap">
            <Link to="/settings">Account</Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="whitespace-nowrap"
            onClick={() =>
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
            }
          >
            <span className="block dark:hidden">Theme: Dark</span>
            <span className="hidden dark:block">Theme: Light</span>
            <MoonIcon className="ml-auto block text-muted-foreground dark:hidden" />
            <SunIcon className="ml-auto hidden text-muted-foreground dark:block" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a
              href="https://devpu.sh/docs"
              target="_blank"
              rel="noreferrer noopener"
            >
              Help
              <ArrowUpRightIcon className="ml-auto opacity-50" />
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
            About devpush
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <SignOutMenuItem />
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  )
}

function DeploymentStatusIcon({
  'data-icon': dataIcon,
  status,
}: {
  'data-icon'?: 'inline-start' | 'inline-end'
  status?: ProjectContext['deployments'][number]['status']
}) {
  if (status === undefined) return <Skeleton className="size-4 shrink-0" />
  if (status === 'succeeded') {
    return (
      <CircleCheckIcon
        data-icon={dataIcon}
        className="size-4 shrink-0 text-success"
      />
    )
  }

  if (status === 'failed') {
    return (
      <CircleAlertIcon
        data-icon={dataIcon}
        className="size-4 shrink-0 text-destructive"
      />
    )
  }

  if (status === 'canceled') {
    return (
      <CircleXIcon
        data-icon={dataIcon}
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  }

  if (status === 'queued') {
    return (
      <Clock3Icon
        data-icon={dataIcon}
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  }

  return (
    <LoaderIcon
      data-icon={dataIcon}
      className="size-4 shrink-0 animate-spin text-muted-foreground"
    />
  )
}

function shortId(id: string) {
  return id.slice(0, 7)
}

function formatInvitationExpiry(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function formatInviteAge(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  )
  if (seconds < 60) return 'just now'
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' })
  for (const [unit, duration] of [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (seconds >= duration)
      return formatter.format(-Math.floor(seconds / duration), unit)
  }
  return 'just now'
}
