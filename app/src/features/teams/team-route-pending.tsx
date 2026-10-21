import {
  WorkspaceSettingsPending,
  workspaceSettingsNavigation,
} from '#devpush/deployment/ui'
import { backupsEnabled } from '@/lib/backup-feature'
import { CopyButton } from '@/components/copy-button'
import {
  InfoIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { ResourceAvatar } from '@/components/resource-avatar'
import { canManageTeamSettings, canManageTeamMembers } from '@/lib/team-role'
import { TeamSettings } from './team-settings'
import { Input } from '@/components/ui/input'
import { DeploymentListPending } from '@/features/deployments/deployment-list'
import { useParams, useRouterState, useHydrated } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { PendingList, PendingTable } from '@/components/pending-collection'
import { TeamPage } from '@/features/teams/team-header'
import { TeamHome, TeamProjects } from '@/features/teams/team-home'
import { TeamServers } from '@/features/servers/team-servers'
import { ProjectRoutePending } from '@/features/projects/project-route-pending'
import { getProjectPendingSection } from '@/features/projects/pending-section'
import { ServerDetailPending } from '@/features/servers/server-detail-pending'
import { Button } from '@/components/ui/button'
import { SettingsLayout, SettingsSection } from '@/components/settings-layout'
import { Skeleton } from '@/components/ui/skeleton'
import {
  teamSectionQueryOptions,
  teamShellQueryOptions,
} from '@/lib/team-context-query'
import { displayNameFromSlug } from '@/lib/display-name'
import { getTeamPendingSection } from './pending-section'
import { teamSettingsNavigationItems } from './navigation'
import { TeamHeading } from './team-heading'

function useCachedTeamContext() {
  const params = useParams({ strict: false })
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : 'team'
  // Observe the loader's cache without starting another request. A completed
  // shell can reveal the real empty state while the section is still loading.
  const hydrated = useHydrated()
  const { data } = useQuery({
    ...teamShellQueryOptions({ teamSlug }),
    enabled: false,
  })
  return hydrated ? data : undefined
}

export function TeamLayoutPending() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = getTeamPendingSection(pathname)

  if (section === 'project') {
    return <ProjectRoutePending section={getProjectPendingSection(pathname)} />
  }

  let content
  if (section === 'new-project') {
    content = <TeamOverviewPending />
  } else if (section === 'settings') {
    content = <TeamSettingsPending />
  } else if (section === 'server') {
    content = <ServerDetailPending />
  } else if (section === 'servers') {
    content = <TeamServersPending />
  } else if (section === 'projects') {
    content = <TeamProjectsPending />
  } else {
    content = <TeamOverviewPending />
  }

  return (
    <TeamPage contentClassName="space-y-8" pending>
      {content}
    </TeamPage>
  )
}

function TeamOverviewInitialPending() {
  return (
    <div className="space-y-8" aria-label="Loading team overview">
      <TeamRouteHeading />
      <section className="space-y-4">
        <header className="flex h-8 items-center justify-between gap-4">
          <h2 className="text-base font-medium">Recent projects</h2>
          <Button disabled>
            <PlusIcon data-icon="inline-start" />
            New project
          </Button>
        </header>
        <ul
          className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          aria-label="Projects loading"
          aria-busy="true"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <li className="rounded-xl border bg-card p-4 text-sm" key={index}>
              <div className="mb-4 flex items-center gap-2.5">
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-5 w-24" />
              </div>
              <div className="space-y-1">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-4/5" />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4">
        <h2 className="flex h-8 items-center text-base font-medium">
          Latest deployments
        </h2>
        <DeploymentListPending
          label="Latest deployments loading"
          displayProject
          rows={3}
        />
      </section>
    </div>
  )
}

function TeamProjectsPending() {
  const context = useCachedTeamContext()

  if (context) {
    return <TeamProjects team={context.team} projects={context.projects} />
  }

  return (
    <div className="space-y-8" aria-label="Loading projects">
      <TeamRouteHeading
        crumb="Projects"
        actions={
          <Button disabled>
            <PlusIcon data-icon="inline-start" />
            New project
          </Button>
        }
      />
      <PendingList label="Projects loading" />
    </div>
  )
}

export function TeamOverviewPending() {
  const context = useCachedTeamContext()
  const params = useParams({ strict: false })
  const { data: sectionResult } = useQuery({
    ...teamSectionQueryOptions({
      teamSlug: params.teamSlug ?? 'team',
      section: 'overview',
    }),
    enabled: false,
  })
  const section = useHydrated() ? sectionResult : undefined
  const deployments =
    section?.section === 'overview' ? section.deployments : undefined

  if (context) {
    return (
      <TeamHome
        team={context.team}
        deployments={deployments ?? []}
        deploymentsPending={
          deployments === undefined && context.projects.length > 0
        }
        projects={context.projects}
        servers={context.servers}
      />
    )
  }

  return <TeamOverviewInitialPending />
}

export function TeamSettingsPending() {
  const context = useCachedTeamContext()
  const params = useParams({ strict: false })
  const { data: sectionResult } = useQuery({
    ...teamSectionQueryOptions({
      teamSlug: params.teamSlug ?? 'team',
      section: 'settings',
    }),
    enabled: false,
  })
  const section = useHydrated() ? sectionResult : undefined
  if (context && section?.section === 'settings')
    return (
      <TeamSettings
        team={context.team}
        currentUserId={context.userContext.user.id}
        isDefaultTeam={
          context.userContext.user.defaultTeamId === context.team.id
        }
        backupStorage={section.settings.backupStorage}
        members={section.settings.members}
        invites={section.settings.invites}
        canDeleteTeam={section.settings.deletionStatus.canDelete}
      />
    )
  return (
    <div className="space-y-8" aria-label="Loading team settings">
      <TeamRouteHeading crumb="Team settings" />
      <SettingsLayout
        navigation={[
          ...teamSettingsNavigationItems.slice(0, 2),
          ...workspaceSettingsNavigation,
          ...teamSettingsNavigationItems.slice(2),
        ]}
      >
        <TeamGeneralPending />
        <TeamMembersPending />
        <WorkspaceSettingsPending />
        {backupsEnabled ? (
          <SettingsSection
            id="backup-storage"
            title="Backup storage"
            description="S3-compatible destinations shared by this workspace’s project backup policies."
            footer={
              !context || canManageTeamSettings(context.team.role) ? (
                <Button disabled>
                  <PlusIcon data-icon="inline-start" />
                  Add storage
                </Button>
              ) : undefined
            }
          >
            <PendingList label="Backup storage loading" />
          </SettingsSection>
        ) : null}
        <SettingsSection
          id="danger"
          title="Danger zone"
          description="Permanently delete the team and all of its settings, projects and deployments."
        >
          <TeamDangerPending />
        </SettingsSection>
      </SettingsLayout>
    </div>
  )
}

export function TeamServersPending() {
  const context = useCachedTeamContext()
  const params = useParams({ strict: false })
  const { data: sectionResult } = useQuery({
    ...teamSectionQueryOptions({
      teamSlug: params.teamSlug ?? 'team',
      section: 'servers',
    }),
    enabled: false,
  })
  const section = useHydrated() ? sectionResult : undefined

  if (context) {
    return (
      <TeamServers
        team={context.team}
        servers={
          section?.section === 'servers' ? section.servers : context.servers
        }
        serverInstall={
          section?.section === 'servers' ? section.serverInstall : undefined
        }
      />
    )
  }

  return (
    <div className="space-y-8" aria-label="Loading servers">
      <TeamRouteHeading
        crumb="Servers"
        actions={
          <Button disabled>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        }
      />
      <PendingList label="Servers loading" />
    </div>
  )
}

function TeamRouteHeading({
  actions,
  crumb,
}: {
  actions?: ReactNode
  crumb?: string
}) {
  const context = useCachedTeamContext()
  const params = useParams({ strict: false })
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : 'team'
  const team = context?.team

  return (
    <TeamHeading
      team={
        team ?? {
          name: displayNameFromSlug(teamSlug),
          slug: teamSlug,
        }
      }
      crumb={crumb ? <span>{crumb}</span> : undefined}
      actions={actions}
    />
  )
}

function TeamGeneralPending() {
  const context = useCachedTeamContext()
  return (
    <SettingsSection
      id="general"
      title="General"
      description="General settings for the team."
      footer={
        !context || canManageTeamSettings(context.team.role) ? (
          <>
            <Button variant="ghost" disabled>
              Cancel
            </Button>
            <Button disabled>Save</Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-8">
        <Field>
          <FieldLabel>Avatar</FieldLabel>
          <div className="flex items-center gap-x-2">
            {context ? (
              <ResourceAvatar
                name={context.team.name}
                src={context.team.image ?? undefined}
                color={context.team.color}
                size="md"
              />
            ) : (
              <Skeleton className="size-10 rounded-xl" />
            )}
            <Button variant="outline" size="sm" disabled>
              <UploadIcon data-icon="inline-start" />
              Upload image
            </Button>
            {context?.team.image ? (
              <Button
                variant="destructive"
                size="icon-sm"
                disabled
                aria-label="Remove image"
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </div>
        </Field>
        <PendingField label="Display name (required)" />
        <PendingField label="Slug (required)" />
        <Field>
          <FieldLabel>Team ID</FieldLabel>
          {context ? (
            <InputGroup>
              <InputGroupInput
                className="font-mono text-[13px] text-muted-foreground"
                value={context.team.id}
                readOnly
              />
              <InputGroupAddon align="inline-end">
                <CopyButton
                  value={context.team.id}
                  label="Copy team ID"
                  inputGroup
                />
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
          <FieldDescription>
            A unique identifier used in API, environment variables, etc.
          </FieldDescription>
        </Field>
      </div>
    </SettingsSection>
  )
}

function TeamMembersPending() {
  const context = useCachedTeamContext()
  return (
    <SettingsSection
      id="members"
      title="Members"
      description="Manage the members of the team."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <InputGroup className="mr-auto max-w-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search..." disabled />
          </InputGroup>
          {!context || canManageTeamMembers(context.team.role) ? (
            <Button variant="outline" disabled>
              <PlusIcon data-icon="inline-start" />
              Add members
            </Button>
          ) : null}
        </div>
        <PendingTable
          label="Members loading"
          avatar
          secondaryName
          columns={[
            { title: 'Name' },
            { title: 'Email' },
            { title: 'Role', className: 'w-[120px]' },
            { title: '', className: 'w-28' },
          ]}
        />
      </div>
    </SettingsSection>
  )
}

function PendingField({ label }: { label: string }) {
  const context = useCachedTeamContext()
  const value = label.startsWith('Display name')
    ? context?.team.name
    : label.startsWith('Slug')
      ? context?.team.slug
      : undefined
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {value ? (
        <Input value={value} readOnly disabled />
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
    </Field>
  )
}

function TeamDangerPending() {
  const context = useCachedTeamContext()
  const message =
    context && context.team.role !== 'owner'
      ? 'Only team owners can delete a team.'
      : context && context.userContext.user.defaultTeamId === context.team.id
        ? 'This is your default team, you cannot leave or delete it.'
        : null
  return message ? (
    <Alert>
      <InfoIcon />
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  ) : (
    <Button variant="destructive" disabled>
      <Trash2Icon data-icon="inline-start" />
      Delete team
    </Button>
  )
}
