import type { TeamRole } from '../lib/team-role'

/** Generic workspace effects; product policies remain in plugins. */
export const workspaceOperations = [
  'workspace.update',
  'workspace.delete',
  'workspace.leave',
  'member.invite',
  'member.accept',
  'member.role',
  'member.remove',
  'member.revoke',
  'owner.transfer',
  'project.create',
  'project.update',
  'project.delete',
  'environment.update',
  'variable.update',
  'domain.update',
  'domain.verify',
  'deployment.create',
  'backup.policy.save',
  'backup.policy.delete',
  'backup.storage.save',
  'backup.storage.delete',
  'backup.run',
  'backup.restore',
  'backup.claim',
  'restore.claim',
  'server.create',
  'server.delete',
  'server.update',
  'server.enable',
  'server.disable',
  'server.enroll',
  'credential.create',
  'credential.rotate',
] as const
export type WorkspaceOperation = (typeof workspaceOperations)[number]
export type WorkspaceActor =
  | { kind: 'user'; userId: string; roleCeiling?: TeamRole }
  | {
      kind: 'system'
      source: 'github.push' | 'backup.schedule' | 'agent' | 'maintenance'
    }
