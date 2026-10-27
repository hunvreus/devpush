import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'
import { publicApiOperations } from '#devpush/server/api/operation-contract'
import { workspaceOperations } from '#devpush/plugins/operations'

// Each new browser mutation requires an explicit operation or documented escape category.
const actionManifest: Record<string, string> = {
  'server/admin/functions.ts:addAllowlistRuleAction': 'admin',
  'server/admin/functions.ts:importAllowlistEmailsAction': 'admin',
  'server/admin/functions.ts:deleteAllowlistRuleAction': 'admin',
  'server/admin/functions.ts:banUserAction': 'admin',
  'server/admin/functions.ts:unbanUserAction': 'admin',
  'server/admin/functions.ts:deleteAdminUserAction': 'admin',
  'server/api/functions.ts:createApiKeyAction': 'credential.create',
  'server/api/functions.ts:rotateApiKeyAction': 'credential.rotate',
  'server/api/functions.ts:revokeApiKeyAction': 'security',
  'server/backups/storage-functions.ts:saveBackupStorageAction':
    'backup.storage.save',
  'server/backups/storage-functions.ts:deleteBackupStorageAction':
    'backup.storage.delete',
  'server/mcp/functions.ts:completeMcpConsentAction': 'credential.create',
  'server/mcp/functions.ts:revokeMcpConnectionAction': 'security',
  'server/projects/functions.ts:createProject': 'project.create',
  'server/projects/functions.ts:saveProjectSettings': 'project.update',
  'server/projects/functions.ts:deleteProjectAction': 'project.delete',
  'server/projects/functions.ts:saveProjectRoutes': 'project.update',
  'server/projects/functions.ts:saveProjectDomains': 'domain.update',
  'server/projects/functions.ts:verifyProjectDomainAction': 'domain.verify',
  'server/projects/functions.ts:saveProjectEnvironments': 'environment.update',
  'server/projects/functions.ts:saveProjectEnvironmentServers':
    'environment.update',
  'server/projects/functions.ts:saveProjectEnvVars': 'variable.update',
  'server/projects/functions.ts:saveProjectBackupPolicyAction':
    'backup.policy.save',
  'server/projects/functions.ts:deleteProjectBackupPolicyAction':
    'backup.policy.delete',
  'server/projects/functions.ts:runProjectBackup': 'backup.run',
  'server/projects/functions.ts:restoreProjectBackup': 'backup.restore',
  'server/projects/functions.ts:deployProject': 'deployment.create',
  'server/projects/functions.ts:rollbackProjectDeployment': 'deployment.create',
  'server/projects/functions.ts:redeployProjectDeployment': 'deployment.create',
  'server/servers/functions.ts:createServer': 'server.create',
  'server/servers/functions.ts:createInstallCommand': 'server.enroll',
  'server/servers/functions.ts:updateServer': 'server.update',
  'server/servers/functions.ts:disableServer': 'server.disable',
  'server/servers/functions.ts:enableServer': 'server.enable',
  'server/servers/functions.ts:getDeleteServerDiagnostic': 'read',
  'server/servers/functions.ts:deleteServer': 'server.delete',
  'server/teams/functions.ts:updateTeamGeneralAction': 'workspace.update',
  'server/teams/functions.ts:createTeamAction': 'creation',
  'server/teams/functions.ts:createTeamInvitesAction': 'member.invite',
  'server/teams/functions.ts:resendTeamInviteAction': 'member.invite',
  'server/teams/functions.ts:revokeTeamInviteAction': 'member.revoke',
  'server/teams/functions.ts:updateTeamMemberRoleAction': 'member.role',
  'server/teams/functions.ts:removeTeamMemberAction': 'member.remove',
  'server/teams/functions.ts:transferTeamOwnershipAction': 'owner.transfer',
  'server/teams/functions.ts:deleteTeamAction': 'workspace.delete',
  'server/teams/functions.ts:acceptTeamInviteAction': 'member.accept',
  'server/teams/functions.ts:acceptUserTeamInviteAction': 'member.accept',
  'server/teams/functions.ts:declineUserTeamInviteAction': 'security',
  'server/teams/functions.ts:declineTeamInviteAction': 'security',
  'server/notifications/functions.ts:updateNotificationPreferences': 'account',
  'server/notifications/functions.ts:updateNotificationMute': 'account',
  'server/users/functions.ts:updateUserGeneralAction': 'account',
  'server/users/functions.ts:requestEmailChangeAction': 'account',
  'server/users/functions.ts:disconnectAuthAccountAction': 'account',
  'server/users/functions.ts:leaveTeamAction': 'workspace.leave',
  'server/users/functions.ts:deleteUserAccountAction': 'account',
  'server/users/onboarding.ts:confirmProfile': 'account',
}
const root = resolve(import.meta.dirname, '../..')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(directory, entry.name))
      : [resolve(directory, entry.name)],
  )
}
const parsed = new Map<string, ts.SourceFile>()
function source(path: string) {
  let sf = parsed.get(path)
  if (!sf) {
    sf = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    parsed.set(path, sf)
  }
  return sf
}
function target(file: string, specifier: string) {
  const path = specifier.startsWith('#devpush/')
    ? resolve(root, specifier.slice(9))
    : specifier.startsWith('.')
      ? resolve(dirname(file), specifier)
      : null
  return path
    ? [path + '.ts', path + '.tsx', path + '/index.ts'].find(existsSync)
    : undefined
}
function reachesGate(
  file: string,
  name: string,
  operation: string,
  seen = new Set<string>(),
): boolean {
  const key = file + ':' + name
  if (seen.has(key)) return false
  seen.add(key)
  const sf = source(file)
  const node = sf.statements
    .flatMap<ts.Node>((statement) =>
      ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations]
        : [statement],
    )
    .find(
      (candidate) =>
        (ts.isFunctionDeclaration(candidate) ||
          ts.isVariableDeclaration(candidate)) &&
        candidate.name?.getText(sf) === name,
    )
  if (!node) return false
  let found = false
  function visit(current: ts.Node) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const callee = current.expression.text
      if (
        callee === 'withWorkspaceAccess' &&
        current.arguments.some(
          (arg) => ts.isStringLiteral(arg) && arg.text === operation,
        )
      )
        found = true
      else if (!found) {
        const imported = sf.statements
          .filter(ts.isImportDeclaration)
          .find(
            (declaration) =>
              declaration.importClause?.namedBindings &&
              ts.isNamedImports(declaration.importClause.namedBindings) &&
              declaration.importClause.namedBindings.elements.some(
                (e) => e.name.text === callee,
              ),
          )
        if (imported && ts.isStringLiteral(imported.moduleSpecifier)) {
          const next = target(file, imported.moduleSpecifier.text)
          if (next && reachesGate(next, callee, operation, seen)) found = true
        } else if (reachesGate(file, callee, operation, seen)) found = true
      }
    }
    if (!found) ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

test('every browser mutation is classified and reaches its declared domain policy', () => {
  const found: Record<string, string> = {}
  for (const file of files(resolve(root, 'server')).filter(
    (candidate) => candidate.endsWith('.ts') && !candidate.includes('.test.'),
  )) {
    const sf = source(file)
    for (const statement of sf.statements.filter(ts.isVariableStatement))
      for (const declaration of statement.declarationList.declarations) {
        const text = declaration.initializer?.getText(sf) ?? ''
        if (
          !text.includes('createServerFn') ||
          !/method:\s*['"]POST['"]/.test(text)
        )
          continue
        const key =
          file.slice(root.length + 1) + ':' + declaration.name.getText(sf)
        expect(
          actionManifest[key],
          `Unclassified mutation ${key}`,
        ).toBeDefined()
        found[key] = actionManifest[key]!
        if (
          workspaceOperations.includes(
            actionManifest[key] as (typeof workspaceOperations)[number],
          )
        )
          expect(
            reachesGate(
              file,
              declaration.name.getText(sf),
              actionManifest[key]!,
            ),
            key,
          ).toBe(true)
      }
  }
  expect(Object.keys(found).sort()).toEqual(Object.keys(actionManifest).sort())
})

test('every REST/MCP write declares its policy boundary explicitly', () => {
  for (const operation of publicApiOperations) {
    if (operation.readOnly) {
      expect(operation.workspacePolicy).toBeNull()
      continue
    }
    expect(operation.workspacePolicy, operation.id).not.toBeNull()
    expect(workspaceOperations).toContain(operation.workspacePolicy!.operation)
    if (operation.workspacePolicy!.boundary === 'domain')
      expect(
        reachesGate(
          resolve(root, 'server/api/mutation-operations.ts'),
          'mutateOperation',
          operation.workspacePolicy!.operation,
        ),
        operation.id,
      ).toBe(true)
  }
})

const routeManifest = {
  'mcp.ts': 'mcp',
  'api/v1/$.ts': 'api-dispatcher',
  'api/auth/$.ts': 'auth',
  'api/plugins/$.ts': 'plugin',
  'api/agents/heartbeat.ts': 'agent',
  'api/agents/switch.ts': 'agent',
  'api/agents/certificates.ts': 'agent',
  'api/agents/runtime-logs.ts': 'agent',
  'api/agents/register.ts': 'agent',
  'api/agents/job-logs.ts': 'agent',
  'api/github/webhook.ts': 'github',
  'api/cron/maintenance.ts': 'system',
  'api/cron/backups.ts': 'system',
  'api/agents/jobs/next.ts': 'agent',
  'api/agents/jobs/status.ts': 'agent',
  'api/agents/jobs/progress.ts': 'agent',
  'api/agents/jobs/complete.ts': 'agent',
  'api/agents/credentials/rotate.ts': 'agent',
}

test('every writable HTTP route has a reviewed transport boundary', () => {
  const found = files(resolve(root, 'routes'))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        /\b(?:POST|PUT|PATCH|DELETE)\s*:/.test(readFileSync(file, 'utf8')),
    )
    .map((file) => file.slice(resolve(root, 'routes').length + 1))
    .sort()
  expect(found).toEqual(Object.keys(routeManifest).sort())
  expect(Object.values(routeManifest)).not.toContain('unknown')
})
