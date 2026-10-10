import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'vitest'
import { setTeamContextQueryData } from './team-context-query'
import { projectContext } from '@/test/project-context'

test('saved team metadata updates shared navigation without refreshing unrelated data', async () => {
  const client = new QueryClient()
  const teamKey = ['team-context', 'team', 'shell']
  const projectKey = ['project-context', 'team', 'project', 'settings']
  const otherKey = ['team-context', 'other', 'shell']
  const oldTime = Date.now() - 60_000
  const otherTeam = { ...projectContext.team, id: 'other', slug: 'other' }
  client.setQueryData(teamKey, projectContext, { updatedAt: oldTime })
  client.setQueryData(projectKey, projectContext, { updatedAt: oldTime })
  client.setQueryData(otherKey, { ...projectContext, team: otherTeam })
  const saved = {
    ...projectContext.team,
    name: 'Renamed',
    image: '/avatar.png',
  }
  await setTeamContextQueryData(client, saved)
  const project = client.getQueryData<typeof projectContext>(projectKey)!
  expect(project.team).toEqual(saved)
  expect(project.userContext.teams[0]).toEqual(saved)
  expect(project.userContext.defaultTeam).toEqual(saved)
  expect(project.project).toEqual(projectContext.project)
  expect(client.getQueryState(projectKey)?.dataUpdatedAt).toBe(oldTime)
  expect(client.getQueryState(teamKey)?.isInvalidated).toBe(false)
  const other = client.getQueryData<typeof projectContext>(otherKey)!
  expect(other.team).toEqual(otherTeam)
  expect(other.userContext.teams[0]).toEqual(saved)
  client.clear()
})
