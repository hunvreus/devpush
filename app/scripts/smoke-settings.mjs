import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { makeSignature } from 'better-auth/crypto'

import { createSmokeRpc } from './smoke-rpc.mjs'

/** Exercise the actual Start HTTP transport against the disposable Node fixture. */
export async function smokeSettings({
  origin,
  authSecret,
  query,
  appDir,
  development = false,
}) {
  const userId = randomUUID(),
    teamId = randomUUID(),
    projectId = randomUUID(),
    envId = randomUUID(),
    token = randomBytes(32).toString('hex')
  const now = Date.now()
  await query(
    0,
    `insert into teams(id,name,slug) values('${teamId}','Settings smoke','${teamId}')`,
  )
  await query(
    0,
    `insert into user(id,name,username,email,email_verified,default_team_id) values('${userId}','Settings smoke','${userId}','${userId}@example.invalid',1,'${teamId}')`,
  )
  await query(
    0,
    `insert into team_members(id,user_id,team_id,role) values('${randomUUID()}','${userId}','${teamId}','owner')`,
  )
  await query(
    0,
    `insert into session(id,token,user_id,expires_at,created_at,updated_at) values('${randomUUID()}','${token}','${userId}',${now + 3600000},${now},${now})`,
  )
  const runtimeConfig = {
    type: 'compose',
    path: null,
    releaseCommand: null,
    releaseService: null,
    readinessPath: null,
    deployCommand: null,
    rollbackCommand: null,
    timeoutSeconds: 1800,
  }
  await query(
    0,
    `insert into projects(id,team_id,name,slug,github_repo,runtime_config) values('${projectId}','${teamId}','original-project','original-project','fixture/repo','${JSON.stringify(runtimeConfig)}')`,
  )
  await query(
    0,
    `insert into environments(id,project_id,name,slug,branch,is_production,runtime_id) values('${envId}','${projectId}','Production','production','main',1,'dp_${envId}')`,
  )
  const headers = {
    cookie: `devpush.session_token=${encodeURIComponent(token + '.' + (await makeSignature(token, authSecret)))}`,
    origin,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-tsr-serverFn': 'true',
  }
  const save = await createSmokeRpc({
    origin,
    headers,
    appDir,
    development,
    name: 'saveProjectSettings',
    modulePath: 'src/server/projects/functions.ts',
  })
  const draft = {
    teamSlug: teamId,
    projectId,
    currentProjectName: 'original-project',
    projectName: 'renamed-project',
    repoFullName: 'fixture/repo',
    installationId: null,
    runtimeConfig,
    settingsVersion: 1,
    section: 'general',
  }
  const first = await save(draft)
  assert.equal(first.result?.context?.project?.name, 'renamed-project')
  const stale = await save({ ...draft, projectName: 'stale-project' })
  assert.equal(stale.error?.name, 'PublicError')
  assert.equal(stale.error?.code, 'SETTINGS_CONFLICT')
  assert.equal(
    stale.error?.reloadUrl,
    `/${teamId}/projects/renamed-project/settings`,
  )
  assert.equal(
    (await query(0, `select name from projects where id = '${projectId}'`))[0]
      .name,
    'renamed-project',
  )
  const buildDraft = {
    ...draft,
    section: 'build',
    currentProjectName: 'renamed-project',
    projectName: 'renamed-project',
    settingsVersion: first.result.context.project.settingsVersion,
    runtimeConfig: { ...runtimeConfig, path: 'first-compose.yml' },
  }
  const buildFirst = await save(buildDraft)
  assert.equal(
    buildFirst.result?.context?.project?.runtimeConfig?.path,
    'first-compose.yml',
  )
  const buildStale = await save({
    ...buildDraft,
    runtimeConfig: { ...runtimeConfig, path: 'second-compose.yml' },
  })
  assert.equal(buildStale.error?.code, 'SETTINGS_CONFLICT')
  assert.equal(
    (
      await query(
        0,
        `select runtime_config from projects where id = '${projectId}'`,
      )
    )[0].runtime_config.includes('first-compose.yml'),
    true,
  )
  console.log(
    'Settings HTTP: concurrent rename and Compose edits preserve conflict codes using default Start transport.',
  )
}
