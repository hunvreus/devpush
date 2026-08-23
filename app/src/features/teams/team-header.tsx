import {
  Link,
  useParams,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  BellIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleQuestionMarkIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  ExternalLinkIcon,
  LoaderIcon,
  MoonIcon,
  SunIcon,
  SettingsIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ResourceAvatar } from '@/components/resource-avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NewProjectDialogLauncher } from '@/features/repositories/new-project-dialog'
import { getServerAvailabilityNotice } from '@/features/servers/server-availability'
import { authClient } from '@/lib/auth/client'
import { getErrorMessage } from '@/lib/error-message'
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
import type { ProjectContext } from '@/server/projects/service'
import type {
  ProjectSummary,
  ServerSummary,
  TeamSummary,
} from '@/server/teams/service'
import {
  acceptUserTeamInviteAction,
  createTeamAction,
} from '@/server/teams/functions'

const teamTabs = [
  { label: 'Overview', to: '/$teamSlug' },
  { label: 'Projects', to: '/$teamSlug/projects' },
  { label: 'Servers', to: '/$teamSlug/servers' },
  { label: 'Settings', to: '/$teamSlug/settings' },
] as const

const backupsEnabled = import.meta.env.VITE_DEVPUSH_BACKUPS_ENABLED === 'true'

const projectTabs = [
  {
    label: 'Overview',
    to: '/$teamSlug/projects/$projectName',
  },
  {
    label: 'Deployments',
    to: '/$teamSlug/projects/$projectName/deployments',
  },
  {
    label: 'Logs',
    to: '/$teamSlug/projects/$projectName/logs',
  },
  {
    label: 'Backups',
    to: '/$teamSlug/projects/$projectName/backups',
  },
  {
    label: 'Settings',
    to: '/$teamSlug/projects/$projectName/settings',
  },
].filter((tab) => backupsEnabled || tab.label !== 'Backups')

type TeamHeaderProps = {
  currentProject?: boolean
  currentProjectContext?: ProjectSummary
  currentProjects?: Array<ProjectSummary>
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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const params = useParams({ strict: false })
  const teamSlug =
    typeof params.teamSlug === 'string'
      ? params.teamSlug
      : (currentTeam?.slug ?? userContext?.defaultTeam.slug ?? '')
  const activeTeam = currentTeam ?? userContext?.defaultTeam
  const tabs = currentProject ? projectTabs : teamTabs

  if (!activeTeam || !userContext) {
    return null
  }

  return (
    <header className="sticky top-0 z-20 flex flex-col gap-y-2 border-b bg-background px-8">
      <div className="flex h-16 items-center justify-between gap-x-4">
        <nav className="flex min-w-0 items-center gap-x-1.5">
          <Link
            to="/"
            className="mr-1 flex h-8 w-6 shrink-0 items-center justify-center"
            aria-label="devpush"
          >
            <LogoMark />
          </Link>
          <span className="text-xl text-muted-foreground/25">/</span>
          <TeamSwitcher currentTeam={activeTeam} teams={userContext.teams} />
          {currentProject ? (
            <>
              <span className="text-xl text-muted-foreground/25">/</span>
              {currentProjectContext ? (
                <ProjectSwitcher
                  teamSlug={teamSlug}
                  project={currentProjectContext}
                  projects={currentProjects}
                />
              ) : null}
            </>
          ) : null}
          {currentDeployment ? (
            <>
              <span className="text-xl text-muted-foreground/25">/</span>
              <DeploymentSwitcher
                deployment={currentDeployment}
                deployments={currentDeployments}
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
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <Link to="/admin">
              <SettingsIcon data-icon="inline-start" />
              Admin
            </Link>
          </Button>
          <HelpMenu />
          <NotificationsMenu invites={userContext.invites} />
          <UserMenu userContext={userContext} />
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
  servers = [],
}: {
  children: ReactNode
  contentClassName?: string
  userContext?: AuthUserContext
  currentTeam?: TeamSummary
  currentProject?: ProjectSummary
  currentProjects?: Array<ProjectSummary>
  servers?: Array<ServerSummary>
}) {
  const serverNotice = getServerAvailabilityNotice(servers)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <TeamHeader
        currentProject={Boolean(currentProject)}
        currentProjectContext={currentProject}
        currentProjects={currentProjects}
        userContext={userContext}
        currentTeam={currentTeam}
      />
      <div
        className={cn('mx-auto w-full max-w-screen-xl p-8', contentClassName)}
      >
        {serverNotice && currentTeam && !currentProject ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle className="truncate">{serverNotice.title}</AlertTitle>
            <AlertDescription>{serverNotice.description}</AlertDescription>
            <AlertAction>
              <Button asChild variant="outline">
                <Link
                  to="/$teamSlug/servers/$serverId"
                  params={{
                    teamSlug: currentTeam.slug,
                    serverId: serverNotice.targetServerId,
                  }}
                >
                  View
                </Link>
              </Button>
            </AlertAction>
          </Alert>
        ) : null}
        {children}
      </div>
    </main>
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

  return (
    <div className="flex items-center">
      <Button asChild variant="ghost" size="sm" className="gap-1.5 px-1.5">
        <Link to="/$teamSlug" params={{ teamSlug: currentTeam.slug }}>
          <ResourceAvatar
            data-icon="inline-start"
            name={currentTeam.name}
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
              await router.invalidate()
              await router.navigate({
                to: '/$teamSlug',
                params: { teamSlug },
              })
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

function NewTeamDialogLauncher({
  children,
  onCreated,
}: {
  children: (open: () => void) => ReactNode
  onCreated: (teamSlug: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  async function createTeam() {
    setNameError(null)
    setIsCreating(true)

    try {
      const team = await createTeamAction({ data: { name } })
      setName('')
      setOpen(false)
      toast.success('Team created.')
      await onCreated(team.slug)
    } catch (error) {
      setNameError(getErrorMessage(error, 'Unable to create team.'))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children(() => setOpen(true))}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
          <DialogDescription>
            Create a team to group projects, servers, and settings.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(nameError)}>
          <FieldLabel htmlFor="new-team-name">Name</FieldLabel>
          <Input
            aria-invalid={Boolean(nameError)}
            id="new-team-name"
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() && !isCreating) {
                event.preventDefault()
                void createTeam()
              }
            }}
          />
          <FieldError>{nameError}</FieldError>
        </Field>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={isCreating}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || isCreating}
            onClick={() => void createTeam()}
          >
            {isCreating ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectSwitcher({
  teamSlug,
  project,
  projects,
}: {
  teamSlug: string
  project: ProjectSummary
  projects: Array<ProjectSummary>
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
    status: ProjectContext['deployments'][number]['status']
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

function LogoMark() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M39.9265 17L16.5652 103.791H0L23.3612 17H39.9265Z" />
      <path d="M81.7018 98.5804L71.6494 88.5988L92.6037 67.6445H47.1555V52.9198H92.6037L71.6494 31.9655L81.7018 21.9839L120 60.2822L81.7018 98.5804Z" />
    </svg>
  )
}

function HelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden sm:inline-flex"
          aria-label="Help"
        >
          <CircleQuestionMarkIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem asChild className="whitespace-nowrap">
          <a href="https://devpu.sh/docs" target="_blank" rel="noreferrer">
            Documentation
            <ExternalLinkIcon className="ml-auto size-3 text-muted-foreground" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="whitespace-nowrap">
          <a href="https://devpu.sh/chat" target="_blank" rel="noreferrer">
            Chat
            <ExternalLinkIcon className="ml-auto size-3 text-muted-foreground" />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NotificationsMenu({
  invites,
}: {
  invites: AuthUserContext['invites']
}) {
  const router = useRouter()
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
      await router.invalidate()
      await router.navigate({ to: '/$teamSlug', params: { teamSlug } })
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
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const { user, defaultTeam } = userContext
  const label = user.name || user.email
  const initial = label.trim().charAt(0).toLocaleUpperCase() || '?'
  const imageUrl = `https://unavatar.io/${encodeURIComponent(
    user.email,
  )}?fallback=${encodeURIComponent(
    `https://avatar.vercel.sh/${encodeURIComponent(user.email)}?size=120`,
  )}`

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
            <AvatarImage src={imageUrl} alt={user.email} />
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
        <DropdownMenuItem
          variant="destructive"
          className="whitespace-nowrap"
          onClick={async () => {
            await authClient.signOut()
            await router.navigate({ to: '/auth/login' })
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DeploymentStatusIcon({
  'data-icon': dataIcon,
  status,
}: {
  'data-icon'?: 'inline-start' | 'inline-end'
  status: ProjectContext['deployments'][number]['status']
}) {
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

function isProjectTabActive(pathname: string, label: string) {
  if (label === 'Overview') {
    return (
      !pathname.includes('/deployments') &&
      !pathname.includes('/logs') &&
      !pathname.includes('/backups') &&
      !pathname.includes('/settings')
    )
  }

  if (label === 'Logs') {
    return pathname.includes('/logs')
  }

  if (label === 'Backups') {
    return pathname.includes('/backups')
  }

  return pathname.includes(label.toLowerCase())
}

function isTeamTabActive(pathname: string, label: string) {
  if (label === 'Overview') {
    return (
      !pathname.includes('/projects') &&
      !pathname.includes('/servers') &&
      !pathname.includes('/settings') &&
      !pathname.includes('/new-project')
    )
  }

  if (label === 'Projects') {
    return pathname.includes('/projects') || pathname.includes('/new-project')
  }

  return pathname.includes(label.toLowerCase())
}
