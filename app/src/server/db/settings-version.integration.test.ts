import { replaceProjectEnvironments } from '@/server/projects/environment-state'
import type * as RepositoryModule from '@/server/projects/repository'
import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '@/server/db'
import {
  teams,
  user,
  teamMembers,
  servers,
  projects,
  environments,
  aliases,
  backupConfigs,
  backupStorage,
} from './schema'
import { updateUserGeneral } from '@/server/users/service'
import { updateTeamGeneral } from '@/server/teams/service'
import { updateTeamServer } from '@/server/servers/service'
import {
  updateProjectEnvVars,
  updateProjectEnvironments,
} from '@/server/projects/environments'
import { getProjectContext } from '@/server/projects/context'
import {
  updateProjectRoutes,
  updateProjectSettings,
} from '@/server/projects/settings'
import { saveProjectBackupPolicy } from '@/server/projects/backups'
import { saveBackupStorage } from '@/server/backups/storage'
import { createComposeRuntimeConfig } from '@/lib/project-runtime-config'

vi.mock('@/server/projects/repository', async (original) => ({
  ...(await original<typeof RepositoryModule>()),
  fetchProjectComposeMetadata: vi.fn(async () => null),
}))
const teamIds: string[] = [],
  userIds: string[] = []
afterEach(async () => {
  for (const id of teamIds.splice(0))
    await db.delete(teams).where(eq(teams.id, id))
  for (const id of userIds.splice(0))
    await db.delete(user).where(eq(user.id, id))
})
afterAll(closeDb)
async function fixture() {
  const id = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    projectId = crypto.randomUUID(),
    serverId = crypto.randomUUID(),
    environmentId = crypto.randomUUID()
  const slug = `settings-${id}`
  teamIds.push(id)
  userIds.push(userId)
  await db.insert(teams).values({ id, slug, name: 'Settings team' })
  await db.insert(user).values({
    id: userId,
    name: 'Settings owner',
    username: `owner-${userId}`,
    email: `${userId}@example.invalid`,
    emailVerified: true,
    defaultTeamId: id,
  })
  await db
    .insert(teamMembers)
    .values({ id: crypto.randomUUID(), teamId: id, userId, role: 'owner' })
  await db.insert(servers).values({
    id: serverId,
    teamId: id,
    name: 'settings-server',
    handle: 'settings-server',
    publicAddress: '192.0.2.1',
  })
  await db.insert(projects).values({
    id: projectId,
    teamId: id,
    name: 'settings-project',
    slug: 'settings-project',
    githubRepo: 'owner/repo',
    runtimeConfig: createComposeRuntimeConfig(),
  })
  await db.insert(environments).values({
    id: environmentId,
    projectId,
    slug: 'production',
    isProduction: true,
    name: 'Production',
    branch: 'main',
    runtimeId: `dp_${environmentId}`,
  })
  return {
    id,
    userId,
    projectId,
    serverId,
    environmentId,
    teamSlug: slug,
    projectName: 'settings-project',
  }
}

test('team, account and server edits reject old versions while operational timestamps do not invalidate forms', async () => {
  const f = await fixture()
  const profile = {
    userId: f.userId,
    name: 'Updated owner',
    username: `owner-${f.userId}`,
    settingsVersion: 1,
  }
  await db
    .update(user)
    .set({ updatedAt: new Date() })
    .where(eq(user.id, f.userId))
  expect(await updateUserGeneral(profile)).toMatchObject({ settingsVersion: 2 })
  await expect(
    updateUserGeneral({ ...profile, name: 'Stale owner' }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  const team = {
    userId: f.userId,
    teamSlug: f.teamSlug,
    name: 'Updated team',
    slug: f.teamSlug,
    settingsVersion: 1,
  }
  expect(await updateTeamGeneral(team)).toMatchObject({ settingsVersion: 2 })
  await expect(
    updateTeamGeneral({ ...team, name: 'Stale team' }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  await db
    .update(servers)
    .set({
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      agentVersion: 'test',
    })
    .where(eq(servers.id, f.serverId))
  const server = {
    userId: f.userId,
    teamSlug: f.teamSlug,
    serverId: f.serverId,
    name: 'updated-server',
    settingsVersion: 1,
  }
  expect(await updateTeamServer(server)).toMatchObject({ settingsVersion: 2 })
  await expect(
    updateTeamServer({ ...server, name: 'stale-server' }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
})

test('all project sections share a settings version; stale lists cannot erase newer variables or environments', async () => {
  const f = await fixture()
  await db
    .update(projects)
    .set({ updatedAt: new Date(), composeMetadata: null })
    .where(eq(projects.id, f.projectId))
  const baseline = await getProjectContext({ ...f, scope: 'settings' })
  expect(baseline.project.settingsVersion).toBe(1)
  const saved = await updateProjectEnvVars({
    ...f,
    settingsVersion: 1,
    envVars: [
      { key: 'TOKEN', value: 'new-value', environment: f.environmentId },
    ],
  })
  expect(saved.project.settingsVersion).toBe(2)
  await expect(
    updateProjectRoutes({ ...f, settingsVersion: 1, routes: [] }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  await expect(
    updateProjectEnvironments({
      ...f,
      settingsVersion: 1,
      projectEnvironments: baseline.environments,
    }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  await expect(
    updateProjectEnvVars({ ...f, settingsVersion: 1, envVars: [] }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  await expect(
    updateProjectSettings({
      ...f,
      currentProjectName: f.projectName,
      settingsVersion: 1,
      section: 'build',
      projectName: f.projectName,
      repoFullName: 'owner/repo',
      installationId: null,
      runtimeConfig: createComposeRuntimeConfig({ path: 'compose.yml' }),
    }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  const current = await getProjectContext({ ...f, scope: 'settings' })
  expect(current.envVars).toEqual(saved.envVars)
  expect(current.project.settingsVersion).toBe(2)
  const routesSaved = await updateProjectRoutes({
    ...f,
    settingsVersion: 2,
    routes: [],
  })
  expect(routesSaved.project.settingsVersion).toBe(3)
})

test('policies and storage have independent versions, preserve creation times and reject stale credential replacements', async () => {
  const f = await fixture()
  const policy = {
    id: crypto.randomUUID(),
    name: 'Nightly',
    environmentId: f.environmentId,
    enabled: true,
    schedule: { cron: '0 2 * * *' },
    destination: {},
    retention: {
      local: { count: 7, days: 0, maxStorageGb: 0 },
      remote: { enabled: false, count: 7, days: 0, maxStorageGb: 0 },
    },
    volumes: { mode: 'none' as const, names: [] },
    databaseDumps: [],
  }
  await saveProjectBackupPolicy({ ...f, settingsVersion: null, policy })
  await saveProjectBackupPolicy({
    ...f,
    settingsVersion: null,
    policy: { ...policy, id: crypto.randomUUID(), name: 'Second policy' },
  })
  const [original] = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, policy.id))
  await saveProjectBackupPolicy({
    ...f,
    settingsVersion: 1,
    policy: { ...policy, name: 'Renamed' },
  })
  await expect(
    saveProjectBackupPolicy({ ...f, settingsVersion: 1, policy }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  const [saved] = await db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.id, policy.id))
  expect(saved?.createdAt).toEqual(original?.createdAt)
  expect(
    (
      await db
        .select()
        .from(backupConfigs)
        .where(eq(backupConfigs.projectId, f.projectId))
    )
      .map((p) => p.settingsVersion)
      .sort(),
  ).toEqual([1, 2])
  expect(
    (await db.select().from(projects).where(eq(projects.id, f.projectId)))[0]
      ?.settingsVersion,
  ).toBe(1)
  const input = {
    name: 'Storage',
    bucket: 'test-settings',
    region: 'auto',
    endpoint: '',
    accessKeyId: 'first',
    secretAccessKey: 'first-secret',
  }
  const [storage] = await saveBackupStorage({
    ...f,
    settingsVersion: null,
    input,
  })
  await saveBackupStorage({
    ...f,
    settingsVersion: 1,
    input: {
      ...input,
      id: storage!.id,
      accessKeyId: 'rotated',
      secretAccessKey: 'rotated-secret',
    },
  })
  await expect(
    saveBackupStorage({
      ...f,
      settingsVersion: 1,
      input: { ...input, id: storage!.id },
    }),
  ).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  expect(
    (
      await db
        .select()
        .from(backupStorage)
        .where(eq(backupStorage.id, storage!.id))
    )[0]?.accessKeyId,
  ).toBe('rotated')
})

test('deployment alias creation does not invalidate an environment settings snapshot', async () => {
  const f = await fixture()
  const previousEnvironments = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, f.projectId))
  await db.insert(aliases).values({
    id: crypto.randomUUID(),
    projectId: f.projectId,
    environmentId: f.environmentId,
    hostname: `${f.projectId}.example.invalid`,
    type: 'branch',
    branch: 'main',
  })
  await replaceProjectEnvironments(db, {
    projectId: f.projectId,
    userId: f.userId,
    settingsVersion: 1,
    previousDefaultServerId: null,
    previousEnvironments,
    previousAliases: [],
    environments: previousEnvironments.map((e) => ({ ...e, alias: null })),
    now: new Date(),
  })
  expect(
    (await db.select().from(projects).where(eq(projects.id, f.projectId)))[0]
      ?.settingsVersion,
  ).toBe(2)
  expect(
    await db.select().from(aliases).where(eq(aliases.projectId, f.projectId)),
  ).toHaveLength(1)
})

test('a stale window editing a renamed project gets a conflict with its current settings URL', async () => {
  const f = await fixture()
  const baseline = await getProjectContext({ ...f, scope: 'settings' })
  const renamed = await updateProjectSettings({
    ...f,
    currentProjectName: f.projectName,
    settingsVersion: baseline.project.settingsVersion,
    section: 'general',
    projectName: 'renamed-project',
    repoFullName: 'owner/repo',
    installationId: null,
    runtimeConfig: baseline.project.runtimeConfig,
  })
  await expect(
    updateProjectSettings({
      ...f,
      currentProjectName: f.projectName,
      settingsVersion: baseline.project.settingsVersion,
      section: 'general',
      projectName: 'stale-project',
      repoFullName: 'owner/repo',
      installationId: null,
      runtimeConfig: baseline.project.runtimeConfig,
    }),
  ).rejects.toMatchObject({
    code: 'SETTINGS_CONFLICT',
    reloadUrl: `/${f.teamSlug}/projects/renamed-project/settings`,
  })
  expect(renamed.project.name).toBe('renamed-project')
})
