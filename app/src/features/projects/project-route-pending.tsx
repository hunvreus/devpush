import { ProjectBackupsPending } from './project-backups-pending'
import { ProjectBackupDetailsPending } from './project-backup-details-pending'
import { ProjectSettings } from './project-settings'
import { ProjectBackups } from './project-backups'
import { ProjectBackupDetails } from './project-backup-details'
import { ProjectLogs } from './project-logs'
import { DeploymentsPage } from '@/features/deployments/deployments-page'
import {
  DeploymentDetail,
  DeploymentMetadata,
  DeploymentLogsPending,
} from '@/features/deployments/deployment-detail'
import { stringSearchValidator } from '@/lib/search'
import type { ProjectContext, DeploymentContext } from '@/server/projects/types'
import { useParams, useRouterState, useHydrated } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { TeamPage } from '@/features/teams/team-header'
import { getCachedTeamContexts } from '@/lib/team-context-query'
import {
  projectContextQueryOptions,
  projectShellQueryOptions,
  projectLogsQueryOptions,
} from '@/lib/project-context-query'
import { ProjectOverview } from '@/features/projects/project-overview'
import { DeploymentListPending } from '@/features/deployments/deployment-list'
import type { ProjectPendingSection } from '@/features/projects/pending-section'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ResourceAvatar } from '@/components/resource-avatar'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from '@/components/ui/input-group'
import {
  CircleHelpIcon,
  Clock3Icon,
  ServerIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  Link2Icon,
  MoreHorizontalIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  SettingsIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '@/components/ui/field'
import { copyText } from '@/lib/action-feedback'
import { SettingsLayout, SettingsSection } from '@/components/settings-layout'
import { projectSettingsNavigationItems } from './project-settings-utils'
import { ProjectHeading } from './project-heading'
import { EnvironmentDot } from './environment-dot'

type PendingProjectContext = {
  avatarUrl: string | null
  color?:
    | 'amber'
    | 'blue'
    | 'green'
    | 'neutral'
    | 'rose'
    | 'lime'
    | 'sky'
    | 'zinc'
  deployments?: ProjectContext['deployments']
  environments?: ProjectContext['environments']
  projectId?: string
  githubRepo?: string
  deploymentId: string | null
  projectName: string
  teamSlug: string
}

export function ProjectRoutePending({
  section,
}: {
  section: ProjectPendingSection
}) {
  return (
    <ProjectPendingPage>
      <ProjectSectionPending section={section} />
    </ProjectPendingPage>
  )
}

export function ProjectSectionPending({
  section,
}: {
  section: ProjectPendingSection
}) {
  const params = useParams({ strict: false })
  const hydrated = useHydrated()
  const queryClient = useQueryClient()
  const projectName =
    typeof params.projectName === 'string' ? params.projectName : 'Project'
  const teamSlug =
    typeof params.teamSlug === 'string' ? params.teamSlug : 'team'
  const cachedProject = (
    hydrated ? getCachedTeamContexts(queryClient, teamSlug) : []
  )
    .flatMap((context) => context.projects)
    .find((project) => project.name === projectName)
  const { data: shellResult } = useQuery({
    ...projectShellQueryOptions({ projectName, teamSlug }),
    enabled: false,
  })
  const { data: overviewResult } = useQuery({
    ...projectContextQueryOptions(
      { projectName, teamSlug, scope: 'overview' },
      queryClient,
    ),
    enabled: false,
  })
  const cachedShell = hydrated ? shellResult : undefined
  const cachedOverview = hydrated ? overviewResult : undefined
  const pendingContext: PendingProjectContext = {
    deployments: (hydrated
      ? queryClient.getQueriesData<ProjectContext>({
          queryKey: ['project-context', teamSlug, projectName],
        })
      : []
    )
      .sort(
        ([first], [second]) =>
          (queryClient.getQueryState(second)?.dataUpdatedAt ?? 0) -
          (queryClient.getQueryState(first)?.dataUpdatedAt ?? 0),
      )
      .flatMap(([, value]) => value?.deployments ?? [])
      .filter(
        (item, index, items) =>
          items.findIndex((other) => other.id === item.id) === index,
      ),
    environments: cachedShell?.environments,
    projectId: cachedShell?.project.id ?? cachedProject?.id,
    githubRepo: cachedShell?.project.githubRepo ?? cachedProject?.githubRepo,
    avatarUrl:
      cachedShell?.project.avatarUrl ?? cachedProject?.avatarUrl ?? null,
    color: cachedShell?.project.color ?? cachedProject?.color,
    deploymentId:
      typeof params.deploymentId === 'string' ? params.deploymentId : null,
    projectName,
    teamSlug,
  }
  const search = useRouterState({ select: (state) => state.location.search })
  const { data: logsResult } = useQuery({
    ...projectLogsQueryOptions(
      {
        projectName,
        teamSlug,
        ...stringSearchValidator([
          'branch',
          'date',
          'deploymentId',
          'environmentId',
          'keyword',
        ] as const)(search),
      },
      queryClient,
    ),
    enabled: false,
  })
  const cachedLogs = hydrated ? logsResult : undefined
  if (section === 'logs' && cachedLogs)
    return <ProjectLogs context={cachedLogs} />
  const scope = section === 'backup' ? 'backups' : section
  const sectionResult = queryClient.getQueryData<ProjectContext>([
    'project-context',
    teamSlug,
    projectName,
    scope,
  ])
  const cached = hydrated ? sectionResult : undefined
  if (cached && section === 'settings')
    return <ProjectSettings context={cached} />
  if (cached && section === 'deployments')
    return (
      <DeploymentsPage
        context={cached}
        filters={stringSearchValidator([
          'branch',
          'date',
          'environment',
          'status',
        ] as const)(search)}
      />
    )
  if (cached && section === 'backups')
    return (
      <ProjectBackups
        context={cached}
        filters={stringSearchValidator([
          'environment',
          'server',
          'status',
          'time',
        ] as const)(search)}
      />
    )
  if (cached && section === 'backup' && typeof params.backupId === 'string')
    return <ProjectBackupDetails context={cached} backupId={params.backupId} />
  const deploymentResult = queryClient.getQueryData<DeploymentContext>([
    'deployment-context',
    teamSlug,
    projectName,
    params.deploymentId,
  ])
  const deployment = hydrated ? deploymentResult : undefined
  if (section === 'deployment' && deployment)
    return <DeploymentDetail context={deployment} />
  let content

  if (section === 'settings') {
    content = <ProjectSettingsPending context={pendingContext} />
  } else if (section === 'deployment') {
    content = <DeploymentDetailPending context={pendingContext} />
  } else if (section === 'backup') {
    content = (
      <BackupDetailPending
        context={pendingContext}
        canManage={cachedShell ? cachedShell.team.role !== 'member' : undefined}
      />
    )
  } else if (section === 'logs') {
    content = <ProjectLogsPending context={pendingContext} />
  } else if (section === 'deployments') {
    content = <DeploymentsPending context={pendingContext} />
  } else if (section === 'backups') {
    content = (
      <ProjectBackupsPending
        heading={
          <ProjectHeadingPending
            context={pendingContext}
            crumbs={['Backups']}
          />
        }
        canManage={cachedShell ? cachedShell.team.role !== 'member' : undefined}
      />
    )
  } else {
    content =
      cachedOverview || cachedShell ? (
        <ProjectOverview
          context={cachedOverview ?? cachedShell!}
          deploymentsPending={!cachedOverview}
        />
      ) : (
        <ProjectOverviewPending context={pendingContext} />
      )
  }

  return content
}

function ProjectPendingPage({ children }: { children: ReactNode }) {
  return (
    <TeamPage contentClassName="space-y-8" projectNavigation pending>
      {children}
    </TeamPage>
  )
}

function ProjectOverviewPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <div className="space-y-8" aria-label="Loading project overview">
      <ProjectHeadingPending context={context} />

      <section className="space-y-4">
        <SectionHeadingPending action label="Environments" />
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 1 }, (_, index) => (
            <div
              className="rounded-xl border bg-card p-4 text-sm text-card-foreground"
              key={index}
            >
              <Skeleton className="mb-4 h-4 w-28" />
              <div className="space-y-1">
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeadingPending label="Latest deployments" />
        <DeploymentListPending label="Latest deployments loading" />
      </section>
    </div>
  )
}

function DeploymentsPending({ context }: { context: PendingProjectContext }) {
  return (
    <div className="space-y-8" aria-label="Loading deployments">
      <ProjectHeadingPending context={context} crumbs={['Deployments']} />
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <PendingFilter
            name="environment"
            label="All environments"
            unknownSelection
          />
          <PendingFilter name="status" label="All statuses" />
          <PendingFilter name="date" label="All dates" />
          <PendingFilter name="branch" label="All branches" />
        </div>
        <DeploymentListPending label="Deployments loading" />
      </section>
    </div>
  )
}

function DeploymentDetailPending({
  context,
}: {
  context: PendingProjectContext
}) {
  const deployment = context.deployments?.find(
    (item) => item.id === context.deploymentId,
  )
  return (
    <div className="space-y-8" aria-label="Loading deployment">
      <ProjectHeadingPending
        context={context}
        crumbs={[
          'Deployments',
          context.deploymentId?.slice(0, 7) ?? 'Deployment',
        ]}
        monoLast
        controls={
          <div className="flex items-center gap-2">
            <Button disabled>
              <Link2Icon data-icon="inline-start" />
              Visit
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled
              aria-label="Deployment options"
            >
              <MoreHorizontalIcon />
            </Button>
          </div>
        }
      />

      {deployment ? (
        <DeploymentMetadata
          deployment={deployment}
          deployments={context.deployments ?? []}
          teamSlug={context.teamSlug}
          projectName={context.projectName}
        />
      ) : (
        <section className="space-y-4 text-sm">
          <div className="flex min-h-5 flex-wrap items-center gap-x-8 gap-y-2">
            <div className="w-28 shrink-0">
              <MetadataItemPending icon={<CircleHelpIcon />} textWidth="w-20" />
            </div>
            <div className="min-w-16">
              <MetadataItemPending icon={<Clock3Icon />} textWidth="w-8" />
            </div>
            <div className="h-5 min-w-20" />
          </div>
          <div className="flex min-h-5 flex-wrap items-center gap-x-8 gap-y-2">
            <MetadataItemPending icon={<EnvironmentDot />} textWidth="w-20" />
            <MetadataItemPending icon={<ServerIcon />} textWidth="w-36" />
            <MetadataItemPending icon={<GitBranchIcon />} textWidth="w-10" />
            <MetadataItemPending
              icon={<GitCommitHorizontalIcon />}
              iconSize={20}
              textWidth="w-40"
            />
          </div>
        </section>
      )}
      <section className="space-y-4">
        <DeploymentLogAreaPending />
        <div className="flex min-h-8 items-start justify-end">
          <Button variant="outline" size="sm" disabled>
            All logs
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </section>
    </div>
  )
}

function MetadataItemPending({
  icon,
  iconSize = 16,
  textWidth,
}: {
  icon: ReactNode
  iconSize?: 16 | 20
  textWidth: string
}) {
  return (
    <div
      className={`flex h-5 items-center gap-x-2 text-muted-foreground [&>svg]:shrink-0 [&>svg]:opacity-50 ${iconSize === 20 ? '[&>svg]:size-5' : '[&>svg]:size-4'}`}
    >
      {icon}
      <Skeleton className={`h-4 ${textWidth}`} />
    </div>
  )
}
function DeploymentLogAreaPending() {
  return (
    <div className="relative h-[500px] rounded-lg border p-2" aria-busy="true">
      <DeploymentLogsPending />
    </div>
  )
}

function ProjectLogsPending({ context }: { context: PendingProjectContext }) {
  const keyword = useRouterState({
    select: (state) => state.location.search.keyword,
  })
  return (
    <div className="space-y-8" aria-label="Loading project logs">
      <ProjectHeadingPending
        context={context}
        crumbs={['Logs']}
        controls={
          <Button variant="outline" size="icon" disabled aria-label="Refresh">
            <RefreshCwIcon />
          </Button>
        }
      />
      <section>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="w-48">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Find in logs"
                placeholder="Find in logs"
                value={typeof keyword === 'string' ? keyword : ''}
                readOnly
                disabled
              />
            </InputGroup>
            <PendingFilter
              name="deploymentId"
              label="All deployments"
              unknownSelection
            />
            <PendingFilter
              name="environmentId"
              label="All environments"
              unknownSelection
            />
            <PendingFilter name="date" label="All dates" />
            <PendingFilter name="branch" label="All branches" />
          </div>
          <LogAreaPending />
        </div>
      </section>
    </div>
  )
}

function ProjectSettingsPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <div className="space-y-8" aria-label="Loading project settings">
      <ProjectHeadingPending context={context} crumbs={['Project settings']} />
      <SettingsLayout navigation={projectSettingsNavigationItems}>
        <ProjectGeneralPending context={context} />
        <BuildDeployPending />
        <EnvironmentSettingsPending context={context} />
        <EnvironmentVariablesPending />
        <ServerSettingsPending context={context} />
        <RouteSettingsPending />
        <DomainSettingsPending />
        <DangerSettingsPending />
      </SettingsLayout>
    </div>
  )
}

function ProjectGeneralPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <SettingsSection
      id="general"
      title="General"
      description="General settings for the project including the Git repository."
      footer={<SettingsFooterPending />}
    >
      <div className="space-y-8">
        <Field>
          <FieldLabel>Avatar</FieldLabel>
          <div className="flex items-center gap-x-2">
            <ResourceAvatar
              name={context.projectName}
              src={context.avatarUrl ?? undefined}
              color={context.color}
              size="md"
            />
            <Button variant="outline" size="sm" disabled>
              <UploadIcon data-icon="inline-start" />
              Upload image
            </Button>
            {context.avatarUrl ? (
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
        <Field>
          <FieldLabel>Project name</FieldLabel>
          <Input value={context.projectName} readOnly disabled />
        </Field>
        <Field>
          <FieldLabel>Git repository</FieldLabel>
          <div className="flex items-center">
            <Button
              variant="outline"
              disabled
              className="rounded-r-none border-r-0 font-normal"
            >
              {context.githubRepo ?? <Skeleton className="h-4 w-40" />}
              <ChevronsUpDownIcon data-icon="inline-end" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-l-none"
              disabled
              aria-label="View on GitHub"
            >
              <ArrowUpRightIcon />
            </Button>
          </div>
        </Field>
        <Field>
          <FieldLabel>Project ID</FieldLabel>
          <InputGroup>
            <InputGroupInput
              className="font-mono text-[13px] text-muted-foreground"
              value={context.projectId ?? ''}
              readOnly
              disabled={!context.projectId}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label="Copy project ID"
                disabled={!context.projectId}
                onClick={() =>
                  context.projectId &&
                  void copyText(context.projectId, 'Project ID')
                }
              >
                <CopyIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>
            A unique identifier used in API, environment variables, etc.
          </FieldDescription>
        </Field>
      </div>
    </SettingsSection>
  )
}

function BuildDeployPending() {
  return (
    <SettingsSection
      id="build-and-deploy"
      title="Build & Deploy"
      description="Configure the Compose file, deployment commands, and health checks."
      footer={<SettingsFooterPending />}
    >
      <FieldGroup>
        <SettingsFieldPending
          label="Compose file path"
          description="Repository-relative path to the Compose file. Defaults to compose.yml."
        />
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)]">
          <SettingsFieldPending
            label="Pre-deploy command"
            multiline
            description={
              <>
                Runs once before services are updated. For example,{' '}
                <code>php artisan migrate --force</code>. Leave empty to skip.
              </>
            }
          />
          <SettingsFieldPending
            label="Pre-deploy service"
            description="Service to run the pre-deploy command."
          />
        </div>
        <SettingsFieldPending
          label="Deploy command"
          multiline
          placeholder="docker compose up -d --no-build"
          description={
            <>
              Runs on the server to update services after images and the
              pre-deploy command are ready. When empty, uses{' '}
              <code>docker compose up -d --no-build</code>.
            </>
          }
        />
        <SettingsFieldPending
          label="Rollback command"
          multiline
          placeholder="docker compose up -d --no-build"
          description="Runs on the server when deploying a previous revision. When empty, uses the deploy command."
        />
        <SettingsFieldPending
          label="Command timeout (required)"
          description="Maximum runtime for either command: 60–7,200 seconds."
        />
        <SettingsFieldPending
          label="Health check path"
          description="Path requested after deployment to confirm the service is ready."
        />
      </FieldGroup>
    </SettingsSection>
  )
}

function SettingsFieldPending({
  multiline = false,
  placeholder,
  description,
  label,
}: {
  multiline?: boolean
  placeholder?: string
  description?: ReactNode
  label: string
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          aria-label={label}
          disabled
          rows={1}
          className="min-h-8 resize-none overflow-hidden py-1.5 font-mono"
          placeholder={placeholder}
        />
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function SettingsFooterPending() {
  return (
    <>
      <Button variant="ghost" disabled>
        Cancel
      </Button>
      <Button disabled>Save</Button>
    </>
  )
}

function EnvironmentSettingsPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <SettingsTablePending
      title="Environments"
      description="Deployments will be associated with the first environment with a matching branch pattern."
      columns="grid-cols-[repeat(3,minmax(0,1fr))_2rem]"
      headers={[
        'Name (required)',
        'Identifier (required)',
        'Branch (required)',
        '',
      ]}
      rows={context.environments?.length ?? 1}
      values={context.environments?.map((environment) => [
        environment.name,
        environment.slug,
        environment.branch,
        null,
      ])}
      action="Add environment"
    />
  )
}

function EnvironmentVariablesPending() {
  return (
    <SettingsTablePending
      title="Environment variables"
      description="Variables available at build time and runtime. Changes will take effect after a new deployment."
      columns="grid-cols-[200px_minmax(0,1fr)_220px_2rem]"
      headers={['Key', 'Value', 'Environment', '']}
      rows={1}
      action="Add variable"
    />
  )
}

function ServerSettingsPending({
  context,
}: {
  context: PendingProjectContext
}) {
  return (
    <SettingsTablePending
      title="Servers"
      description="Choose a default server, then override individual environments when needed."
      columns="grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      headers={['Scope', 'Server']}
      rows={1 + (context.environments?.length ?? 1)}
      values={[
        ['Default', null],
        ...(context.environments?.map((environment) => [
          environment.name,
          null,
        ]) ?? [[null, null]]),
      ]}
    />
  )
}

function RouteSettingsPending() {
  return (
    <SettingsTablePending
      title="Routes"
      description="Default routes apply to every environment. Environment routes add paths or override the default target for the same path."
      columns="grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.1fr)_1rem_minmax(0,1.1fr)_minmax(5.5rem,0.4fr)_3.5rem_2.5rem]"
      headers={['Scope', 'Path *', '', 'Service *', 'Port *', 'Strip', '']}
      rows={1}
      action="Add route"
    />
  )
}

function DomainSettingsPending() {
  return (
    <SettingsTablePending
      title="Domains"
      description="Custom domain names associated with this project's environments."
      columns="grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_5.5rem_2.5rem]"
      headers={['Host *', 'Environment *', 'Base route', 'HTTPS', 'Status', '']}
      rows={1}
      action="Add domain"
    />
  )
}

function DangerSettingsPending() {
  return (
    <SettingsSection
      id="danger"
      title="Danger"
      description="Permanently delete the project and all of its configuration, environments and deployments."
    >
      <Button variant="destructive" disabled>
        Delete project
      </Button>
    </SettingsSection>
  )
}

function SettingsTablePending({
  action,
  columns,
  description,
  headers,
  rows,
  title,
  values,
}: {
  action?: string
  columns: string
  description: string
  headers: Array<string>
  rows: number
  values?: Array<Array<string | null>>
  title: string
}) {
  return (
    <SettingsSection
      id={title.toLowerCase().replaceAll(' ', '-')}
      title={title}
      description={description}
      footer={<SettingsFooterPending />}
    >
      <div
        className={`grid gap-x-2 border-b ${title === 'Routes' || title === 'Domains' ? 'pb-2' : 'pb-3'} text-sm font-medium ${columns}`}
      >
        {headers.map((header, index) => (
          <span key={`${header}:${index}`}>{header}</span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          className={`grid min-h-12 items-center gap-x-2 border-b py-2 ${columns}`}
          key={row}
        >
          {headers.map((header, column) =>
            values?.[row]?.[column] != null ? (
              title === 'Servers' ? (
                <span className="text-sm" key={column}>
                  {values[row][column]}
                </span>
              ) : (
                <Input
                  key={column}
                  value={values[row][column] ?? ''}
                  readOnly
                  disabled
                />
              )
            ) : (
              <Skeleton
                className={
                  header === '' ? 'size-8 justify-self-end' : 'h-8 w-full'
                }
                key={column}
              />
            ),
          )}
        </div>
      ))}
      {action ? (
        <Button className="mt-3" variant="outline" disabled>
          <PlusIcon data-icon="inline-start" />
          {action}
        </Button>
      ) : null}
    </SettingsSection>
  )
}

function BackupDetailPending({
  context,
  canManage,
}: {
  context: PendingProjectContext
  canManage?: boolean
}) {
  return (
    <ProjectBackupDetailsPending
      canManage={canManage}
      heading={
        <ProjectHeadingPending context={context} crumbs={['Backups', null]} />
      }
    />
  )
}

function ProjectHeadingPending({
  controls,
  context,
  crumbs = [],
  monoLast = false,
}: {
  controls?: ReactNode
  context: PendingProjectContext
  crumbs?: Array<string | null>
  monoLast?: boolean
}) {
  return (
    <ProjectHeading
      teamSlug={context.teamSlug}
      project={{
        avatarUrl: context.avatarUrl,
        color: context.color,
        name: context.projectName,
      }}
      crumbs={crumbs.map((crumb, index) =>
        crumb ? (
          <span
            className={
              monoLast && index === crumbs.length - 1
                ? 'truncate font-mono'
                : 'truncate'
            }
          >
            {crumb}
          </span>
        ) : (
          <Skeleton className="h-8 w-32" />
        ),
      )}
      actions={controls}
    />
  )
}

function SectionHeadingPending({
  action = false,
  label,
}: {
  action?: boolean
  label: string
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-4">
      <h2 className="text-base font-medium">{label}</h2>
      {action ? (
        <Button disabled>
          <SettingsIcon data-icon="inline-start" />
          Manage environments
        </Button>
      ) : null}
    </div>
  )
}

function LogAreaPending() {
  return (
    <div className="relative h-[500px] rounded-lg border p-2" aria-busy="true">
      <p role="status" className="p-2 text-sm text-muted-foreground">
        Loading logs…
      </p>
    </div>
  )
}

function PendingFilter({
  name,
  label,
  className,
  unknownSelection = false,
}: {
  name: string
  label: string
  className?: string
  unknownSelection?: boolean
}) {
  const search = useRouterState({ select: (state) => state.location.search })
  const value = (search as Record<string, unknown>)[name]
  const selected = typeof value === 'string' && value !== 'all' && value !== ''
  const dates: Record<string, string> = {
    today: 'Today',
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
  }
  const selectedLabel = selected
    ? name === 'date'
      ? (dates[value] ?? label)
      : name === 'status'
        ? value.charAt(0).toUpperCase() + value.slice(1)
        : value
    : label
  return (
    <Select disabled>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue>
          {selected && unknownSelection ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            selectedLabel
          )}
        </SelectValue>
      </SelectTrigger>
    </Select>
  )
}
