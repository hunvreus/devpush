import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { makeSignature } from 'better-auth/crypto'
import { createSmokeRpc } from './smoke-rpc.mjs'

/** Exercises the composed local/npm fixture plugins through real core handlers. */
export async function smokePluginServices({
  origin,
  authSecret,
  query,
  appDir,
  development = false,
  modulePrefix = 'src',
  bundleDir,
}) {
  if (process.env.DEVPUSH_SMOKE_PLUGINS !== '1') return
  const teamId = randomUUID(),
    userId = randomUUID(),
    token = randomBytes(32).toString('hex'),
    now = Date.now()
  await query(
    0,
    `insert into teams(id,name,slug) values('${teamId}','Plugin smoke','${teamId}')`,
  )
  await query(
    0,
    `insert into user(id,name,username,email,email_verified,default_team_id,profile_confirmed_at) values('${userId}','Plugin smoke','${userId}','${userId}@example.invalid',1,'${teamId}',${now})`,
  )
  await query(
    0,
    `insert into team_members(id,user_id,team_id,role) values('${randomUUID()}','${userId}','${teamId}','owner')`,
  )
  await query(
    0,
    `insert into session(id,token,user_id,expires_at,created_at,updated_at) values('${randomUUID()}','${token}','${userId}',${now + 3600000},${now},${now})`,
  )
  const headers = {
    cookie: `devpush.session_token=${encodeURIComponent(token + '.' + (await makeSignature(token, authSecret)))}`,
    origin,
  }
  const create = await createSmokeRpc({
    origin,
    headers,
    appDir,
    development,
    name: 'createServer',
    modulePath: `${modulePrefix}/server/servers/functions.ts`,
    ...(bundleDir ? { bundleDir } : {}),
  })
  const events = async (id) =>
    (await fetch(`${origin}/api/plugins/${id}/events?team=${teamId}`)).json()
  const created = await create({ teamSlug: teamId, name: 'plugin-server' })
  assert.ok(created.result?.id, JSON.stringify(created))
  for (const id of ['local-proof', 'npm-proof'])
    assert.deepEqual(await events(id), [`${id}:before`, `${id}:after`])
  assert.deepEqual(
    await (
      await fetch(`${origin}/api/plugins/local-proof/order?team=${teamId}`)
    ).json(),
    [
      'local-proof:before',
      'npm-proof:before',
      'npm-proof:after',
      'local-proof:after',
    ],
  )
  const agentToken = 'dpa_' + randomBytes(32).toString('hex')
  await query(
    0,
    `update servers set status='connected',agent_credential_hash='${createHash('sha256').update(agentToken).digest('hex')}' where id='${created.result.id}'`,
  )
  const certificate = (token) =>
    fetch(`${origin}/api/agents/certificates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId: created.result.id, token }),
    })
  assert.equal((await certificate('invalid-credential')).status, 401)
  assert.deepEqual(await events('local-proof'), [
    'local-proof:before',
    'local-proof:after',
  ])
  const response = await certificate(agentToken)
  assert.equal(response.status, 200, await response.clone().text())
  assert.deepEqual(await response.json(), {
    status: 'configuration',
    dnsNames: ['*.proof.example.test'],
  })
  assert.deepEqual(await events('local-proof'), [
    'local-proof:before',
    'local-proof:after',
    'local-proof:reconcile',
    'local-proof:certificate',
  ])
  assert.deepEqual(await events('npm-proof'), [
    'npm-proof:before',
    'npm-proof:after',
    'npm-proof:reconcile',
  ])
  await query(
    0,
    `update team_members set role='member' where team_id='${teamId}'`,
  )
  assert.equal(
    (await create({ teamSlug: teamId, name: 'forbidden' })).error?.code,
    'FORBIDDEN',
  )
  assert.equal(
    (await events('local-proof')).length,
    4,
    'RBAC must run before policies',
  )
  await query(
    0,
    `update team_members set role='owner' where team_id='${teamId}'`,
  )
  assert.equal(
    (
      await fetch(`${origin}/api/plugins/local-proof/deny?team=${teamId}`, {
        method: 'POST',
      })
    ).status,
    204,
  )
  assert.equal(
    (await create({ teamSlug: teamId, name: 'restricted' })).error?.code,
    'WORKSPACE_RESTRICTED',
  )
  assert.equal(
    (await events('npm-proof')).length,
    3,
    'Rejecting policy must prevent later policies',
  )
  assert.equal(
    (
      await query(
        0,
        `select count(*) as n from servers where team_id='${teamId}'`,
      )
    )[0].n,
    1,
    'Refused operations must not write',
  )
  console.log(
    'Installed local/npm policies, RBAC ordering, lifecycle fan-out and authenticated certificate provider passed.',
  )
}
