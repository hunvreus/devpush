import { LogoMark } from '@/components/logo-mark'
import { invalidateResourceQueries } from '@/lib/resource-cache'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { HelpDialog } from './help-dialog'
import { NewTeamDialogLauncher } from './new-team-dialog'
import { SignOutMenuItem } from '@/features/auth/sign-out-menu-item'
import { afterMutation } from '@/lib/action-feedback'
import {
  Link,
  useParams,
  useHydrated,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { deploymentContextQueryOptions } from '@/lib/project-context-query'
import { useTheme } from 'next-themes'
import {
  BellIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  LoaderIcon,
  MoonIcon,
  SunIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getCachedTeamContexts } from '@/lib/team-context-query'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ResourceAvatar } from '@/components/resource-avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { NewProjectDialogLauncher } from '@/features/repositories/new-project-dialog-launcher'
import { getServerAvailabilityNotice } from '@/features/servers/server-availability'
import { ServerAvailabilityAlert } from '@/features/servers/server-availability-alert'
import { getErrorMessage } from '@/lib/error-message'
import { displayNameFromSlug } from '@/lib/display-name'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AuthUserContext } from '@/server/auth/context'
import type { ProjectContext } from '@/server/projects/types'
import type {
  ProjectSummary,
  ServerSummary,
  TeamSummary,
} from '@/server/teams/types'
import { acceptUserTeamInviteAction } from '@/server/teams/functions'
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
    select: (state) => state.location.pathname,
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
  const { data: deploymentContext } = useQuery({
    ...deploymentContextQueryOptions(
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
    (hydrated ? deploymentContext?.deployment : undefined) ??
    (routeDeploymentId
      ? { id: routeDeploymentId, status: undefined }
      : undefined)
  const activeDeployments =
    hydrated && deploymentContext
      ? deploymentContext.latestDeployments
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
    <header className="sticky top-0 z-20 flex flex-col gap-y-2 border-b bg-background px-8">
      <div className="flex h-16 items-center justify-between gap-x-4">
        <nav className="flex min-w-0 items-center gap-x-1.5">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="mr-1 shrink-0"
          >
            <Link to="/" aria-label="devpush">
              <LogoMark />
            </Link>
          </Button>
          <span className="text-xl text-muted-foreground/25">/</span>
          {activeTeam && activeUserContext ? (
            <TeamSwitcher
              currentTeam={activeTeam}
              teams={activeUserContext.teams}
            />
          ) : (
            <PendingResourceSwitcher
              label={displayNameFromSlug(teamSlug)}
              name={teamSlug}
              ariaLabel="Team loading"
              teamSlug={teamSlug}
            />
          )}
          {currentProject ? (
            <>
              <span className="text-xl text-muted-foreground/25">/</span>
              {activeProject ? (
                <ProjectSwitcher
                  teamSlug={teamSlug}
                  project={activeProject}
                  projects={activeProjects}
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
              <span className="text-xl text-muted-foreground/25">/</span>
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
        </nav>

        <nav className="flex items-center gap-x-2" aria-label="User menu">
          <HelpDialog />
          {activeUserContext ? (
            <>
              <NotificationsMenu invites={activeUserContext.invites} />
              <UserMenu userContext={activeUserContext} />
            </>
          ) : (
            <PendingUserNavigation />
          )}
        </nav>
      </div>

      <nav className="-mt-2 -mb-[1px]" aria-label="Secondary navigation">
        <ul className="flex items-center gap-x-1" role="tablist">
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
                className={`border-b-2 pb-1.5 ${
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <TeamHeader
        currentProject={projectNavigation || Boolean(currentProject)}
        currentProjectContext={currentProject}
        currentProjects={currentProjects}
        userContext={userContext}
        currentTeam={currentTeam}
      />
      <div
        className={cn('mx-auto w-full max-w-screen-xl p-8', contentClassName)}
        aria-busy={pending || undefined}
      >
        {serverNotice && currentTeam && !currentProject ? (
          <ServerAvailabilityAlert notice={serverNotice} team={currentTeam} />
        ) : null}
        {children}
      </div>
    </main>
  )
}

function PendingResourceSwitcher({
  ariaLabel,
  label,
  name,
  projectName,
  teamSlug,
}: {
  ariaLabel: string
  label: string
  name: string
  projectName?: string
  teamSlug: string
}) {
  const content = (
    <>
      <ResourceAvatar data-icon="inline-start" name={name} size="xs" />
      <span>{label}</span>
    </>
  )

  return (
    <div className="flex items-center" aria-label={ariaLabel}>
      <Button asChild variant="ghost" size="sm" className="gap-1.5 px-1.5">
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
        className="pointer-events-none text-muted-foreground"
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
        className="pointer-events-none"
        aria-label="Notifications loading"
        tabIndex={-1}
      >
        <BellIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="rounded-full border-0"
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
  currentTeam,
  teams,
}: {
  currentTeam: TeamSummary
  teams: Array<TeamSummary>
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  return (
    <div className="flex items-center">
      <Button asChild variant="ghost" size="sm" className="gap-1.5 px-1.5">
        <Link to="/$teamSlug" params={{ teamSlug: currentTeam.slug }}>
          <ResourceAvatar
            data-icon="inline-start"
            name={currentTeam.name}
            src={currentTeam.image ?? undefined}
            color={currentTeam.color}
            size="xs"
          />
          <span>{currentTeam.name}</span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Switch team"
          >
            <ChevronsUpDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-auto">
          <DropdownMenuItem className="gap-1.5 whitespace-nowrap">
            <ResourceAvatar
              name={currentTeam.name}
              src={currentTeam.image ?? undefined}
              color={currentTeam.color}
              size="xs"
            />
            <span>{currentTeam.name}</span>
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
                  <span>{teamOption.name}</span>
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
  teamSlug,
  project,
  projects,
}: {
  teamSlug: string
  project: ProjectNavigationSummary
  projects: Array<ProjectNavigationSummary>
}) {
  const params = useParams({ strict: false })
  const projectName =
    typeof params.projectName === 'string' ? params.projectName : project.name

  return (
    <div className="flex items-center">
      <Button asChild variant="ghost" size="sm" className="gap-1.5 px-1.5">
        <Link
          to="/$teamSlug/projects/$projectName"
          params={{ teamSlug, projectName }}
        >
          <ResourceAvatar
            data-icon="inline-start"
            name={project.name}
            src={project.avatarUrl ?? undefined}
            color={project.color}
            size="xs"
          />
          <span>{project.name}</span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Switch project"
          >
            <ChevronsUpDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-auto">
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
              <span>{project.name}</span>
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
                  <span>{projectOption.name}</span>
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
    <div className="flex items-center">
      <Button asChild variant="ghost" size="sm" className="px-1.5">
        <Link
          to="/$teamSlug/projects/$projectName/deployments/$deploymentId"
          params={{ teamSlug, projectName, deploymentId: deployment.id }}
          aria-label={`Deployment ${shortId(deployment.id)}: ${deployment.status ?? 'loading'}`}
        >
          <DeploymentStatusIcon
            data-icon="inline-start"
            status={deployment.status}
          />
          <span className="font-mono text-[13px]">
            {shortId(deployment.id)}
          </span>
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Switch deployment"
            disabled={deployment.status === undefined}
          >
            <ChevronsUpDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-auto">
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
  const invitationLabel =
    invites.length === 1 ? '1 team invitation' : `${invites.length} invitations`

  async function acceptInvite() {
    if (!selectedInvite) {
      return
    }

    setBusyInviteId(selectedInvite.id)

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
      toast.error(getErrorMessage(error, 'Unable to accept invitation.'))
    } finally {
      setBusyInviteId(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label="Notifications"
          >
            <BellIcon />
            {invites.length > 0 ? (
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-red-500" />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={invites.length > 0 ? 'w-80' : 'w-auto'}
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
                  className="gap-3 whitespace-normal"
                  onSelect={(event) => {
                    event.preventDefault()
                    setSelectedInvite(invite)
                  }}
                >
                  <ResourceAvatar
                    name={invite.team.name}
                    src={invite.team.image ?? undefined}
                    color={invite.team.color}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {invite.team.name}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {invite.inviter
                        ? `${invite.inviter.name || invite.inviter.email} invited you as ${invite.role}`
                        : `Invited as ${invite.role}`}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatShortDate(invite.createdAt)}
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
            <DialogTitle>Team invitation</DialogTitle>
            <DialogDescription>
              {selectedInvite?.inviter
                ? `${selectedInvite.inviter.name || selectedInvite.inviter.email} invited you to join this team.`
                : 'You have been invited to join this team.'}
            </DialogDescription>
          </DialogHeader>

          {selectedInvite ? (
            <div className="flex items-center gap-3 rounded-md border p-3">
              <ResourceAvatar
                name={selectedInvite.team.name}
                src={selectedInvite.team.image ?? undefined}
                color={selectedInvite.team.color}
                size="default"
              />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {selectedInvite.team.name}
                </p>
                <p className="text-muted-foreground">
                  {selectedInvite.role} role · Expires{' '}
                  {formatShortDate(selectedInvite.expiresAt)}
                </p>
              </div>
            </div>
          ) : null}

          <DialogFooter>
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
              {busyInviteId ? (
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
  const { resolvedTheme, setTheme } = useTheme()
  const { user, defaultTeam } = userContext
  const label = user.name || user.email
  const initial = label.trim().charAt(0).toLocaleUpperCase() || '?'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full border-0"
          aria-label="User menu"
        >
          <Avatar className="size-6">
            {user.image ? (
              <AvatarImage src={user.image} alt={user.email} />
            ) : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuLabel className="px-2.5 py-1.5 text-sm text-foreground">
          <span className="block whitespace-nowrap font-medium">{label}</span>
          <span className="block whitespace-nowrap text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="whitespace-nowrap">
          <Link to="/settings">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="whitespace-nowrap">
          <Link to="/$teamSlug" params={{ teamSlug: defaultTeam.slug }}>
            Default team
          </Link>
        </DropdownMenuItem>
        {user.isInstallationAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/admin">
                <SettingsIcon />
                Admin
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="whitespace-nowrap"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          <span className="block dark:hidden">Theme: Dark</span>
          <span className="hidden dark:block">Theme: Light</span>
          <MoonIcon className="ml-auto block text-muted-foreground dark:hidden" />
          <SunIcon className="ml-auto hidden text-muted-foreground dark:block" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SignOutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
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
        className="size-4 shrink-0 text-green-500"
      />
    )
  }

  if (status === 'failed') {
    return (
      <CircleXIcon
        data-icon={dataIcon}
        className="size-4 shrink-0 text-destructive"
      />
    )
  }

  if (status === 'canceled') {
    return (
      <XIcon
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}
