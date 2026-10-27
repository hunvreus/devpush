import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Field, FieldLabel, FieldError } from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import { Button } from '#devpush/components/ui/button'
import { ResourceAvatar } from '#devpush/components/resource-avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import {
  getApiKeyTeamsAction,
  getApiKeyProjectsAction,
} from '#devpush/server/api/functions'
import type {
  ApiKeyProjectOption,
  ApiKeyTeamOption,
} from '#devpush/lib/api-key-schema'
import { getPublicErrorMessage } from '#devpush/lib/public-error'

export function ApiScopeSelection({
  userId,
  teamId,
  projectId,
  onChange,
  initialTeams,
  disabled = false,
}: {
  userId: string
  teamId: string
  projectId: string
  onChange: (teamId: string, projectId: string) => void
  initialTeams: ApiKeyTeamOption[]
  disabled?: boolean
}) {
  const [teamSearch, setTeamSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const teamQuery = useDeferredValue(teamSearch)
  const projectQuery = useDeferredValue(projectSearch)
  const [teamPage, setTeamPage] = useState(1)
  const [projectPage, setProjectPage] = useState(1)
  const [chosenTeam, setChosenTeam] = useState<ApiKeyTeamOption | undefined>(
    initialTeams.find((team) => team.id === teamId),
  )
  const [chosenProject, setChosenProject] = useState<ApiKeyProjectOption>()
  const teamOptions = useQuery({
    queryKey: ['account-key-teams', userId, teamQuery, teamPage],
    queryFn: () =>
      getApiKeyTeamsAction({ data: { query: teamQuery, page: teamPage } }),
    staleTime: 30_000,
  })
  const projectOptions = useQuery({
    queryKey: [
      'account-key-projects',
      userId,
      teamId,
      projectQuery,
      projectPage,
    ],
    queryFn: () =>
      getApiKeyProjectsAction({
        data: { teamId, query: projectQuery, page: projectPage },
      }),
    enabled: Boolean(teamId),
    staleTime: 30_000,
  })
  const teams = teamOptions.data?.items ?? initialTeams
  const projects = projectOptions.data?.items ?? []
  const selectedTeam = teams.find((team) => team.id === teamId) ?? chosenTeam
  const selectedProject =
    projects.find((project) => project.id === projectId) ?? chosenProject
  return (
    <>
      <Field>
        <FieldLabel>Scope</FieldLabel>
        {teamSearch || (teamOptions.data?.pagination.total ?? 0) > 25 ? (
          <Input
            aria-label="Find a team for API access"
            placeholder="Find a team…"
            value={teamSearch}
            disabled={disabled}
            onChange={(event) => {
              setTeamSearch(event.target.value)
              setTeamPage(1)
            }}
          />
        ) : null}
        <Select
          value={teamId}
          disabled={disabled || (!teamOptions.data && !initialTeams.length)}
          onValueChange={(value) => {
            setChosenTeam(teams.find((team) => team.id === value))
            setChosenProject(undefined)
            setProjectSearch('')
            setProjectPage(1)
            onChange(value, 'all')
          }}
        >
          <SelectTrigger
            aria-label="API access team"
            className="min-w-0 w-full"
          >
            <SelectValue className="min-w-0">
              {selectedTeam ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ResourceAvatar
                    name={selectedTeam.name}
                    src={selectedTeam.image ?? undefined}
                    color={selectedTeam.color}
                    size="xs"
                  />
                  <span className="truncate">{selectedTeam.name}</span>
                </span>
              ) : (
                'Select a team'
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem value={team.id} key={team.id} textValue={team.name}>
                <span className="flex min-w-0 items-center gap-2">
                  <ResourceAvatar
                    name={team.name}
                    src={team.image ?? undefined}
                    color={team.color}
                    size="xs"
                  />
                  <span className="truncate">{team.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {teamOptions.data ? (
          <ScopePagination
            pagination={teamOptions.data.pagination}
            busy={disabled || teamOptions.isFetching}
            onChange={setTeamPage}
          />
        ) : null}
        {teamOptions.isError ? (
          <FieldError>
            {getPublicErrorMessage(teamOptions.error, 'Unable to load teams.')}
          </FieldError>
        ) : null}
        {projectSearch || (projectOptions.data?.pagination.total ?? 0) > 25 ? (
          <Input
            aria-label="Find a project for API access"
            placeholder="Find a project…"
            value={projectSearch}
            disabled={disabled}
            onChange={(event) => {
              setProjectSearch(event.target.value)
              setProjectPage(1)
            }}
          />
        ) : null}
        <Select
          value={projectId}
          disabled={disabled || !teamId}
          onValueChange={(value) => {
            setChosenProject(projects.find((project) => project.id === value))
            onChange(teamId, value)
          }}
        >
          <SelectTrigger
            aria-label="API access projects"
            className="min-w-0 w-full"
          >
            <SelectValue className="min-w-0">
              {projectId === 'all' ? (
                'All projects'
              ) : selectedProject ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ResourceAvatar
                    name={selectedProject.name}
                    src={selectedProject.avatarUrl ?? undefined}
                    color={selectedProject.color}
                    size="xs"
                  />
                  <span className="truncate">{selectedProject.name}</span>
                </span>
              ) : (
                'Select a project'
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem
                value={project.id}
                key={project.id}
                textValue={project.name}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ResourceAvatar
                    name={project.name}
                    src={project.avatarUrl ?? undefined}
                    color={project.color}
                    size="xs"
                  />
                  <span className="truncate">{project.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectOptions.data ? (
          <ScopePagination
            pagination={projectOptions.data.pagination}
            busy={disabled || projectOptions.isFetching}
            onChange={setProjectPage}
          />
        ) : null}
        {projectOptions.isError ? (
          <FieldError>
            {getPublicErrorMessage(
              projectOptions.error,
              'Unable to load projects.',
            )}
          </FieldError>
        ) : null}
      </Field>
    </>
  )
}
function ScopePagination({
  pagination,
  busy,
  onChange,
}: {
  pagination: { page: number; totalPages: number }
  busy: boolean
  onChange: (page: number) => void
}) {
  if (pagination.totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        Page {pagination.page} of {pagination.totalPages}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || pagination.page <= 1}
          onClick={() => onChange(pagination.page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || pagination.page >= pagination.totalPages}
          onClick={() => onChange(pagination.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
