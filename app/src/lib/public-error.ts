export const publicErrorMessages = {
  WORKSPACE_RESTRICTED:
    'This workspace does not currently allow this action. Review its settings to continue.',
  WORKSPACE_LIMIT_REACHED:
    'This action exceeds the workspace allowance. Review its settings to continue.',
  RESOURCE_BUSY: 'Another workspace change is in progress. Please try again.',
  SETTINGS_CONFLICT:
    'Settings changed since you started editing. Reload to load the latest settings.',
  GITHUB_ACCESS_REFRESH_FAILED:
    'Unable to refresh GitHub access. Try again or reconnect GitHub in Account settings.',
  API_KEY_CREATION_UNAVAILABLE:
    'API key could not be created. Check the scope and your current access, or revoke an unused key if you already have 100 active keys.',
  API_KEY_REVOKED: 'This API key has been revoked. Create a new key instead.',
  API_KEY_EXPIRED: 'This API key has expired. Create a new key instead.',
  MCP_CONNECTION_CREATION_UNAVAILABLE:
    'MCP connection could not be created. Check your current access, or revoke an unused connection if you already have 100 active connections.',
  ACCOUNT_EMAIL_UNCHANGED: 'Enter a different email address.',
  ACCOUNT_EMAIL_NOT_ALLOWED:
    'This email address is not allowed for your account.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  PROJECT_NAME_INVALID:
    'Project names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
  PROJECT_ENVIRONMENT_IDENTIFIER_DUPLICATED:
    'Environment identifiers must be unique.',
  PROJECT_GITHUB_ACCOUNT_REQUIRED:
    'Connect your GitHub account before selecting a repository.',
  PROJECT_GITHUB_ACCOUNT_INSTALLATION_REQUIRED:
    'Install the GitHub App for this account to continue.',
  PROJECT_SERVER_INVALID: 'Select a valid server.',
  PROJECT_CREATION_GITHUB_REQUIRED: 'Connect GitHub before creating a project.',
  PROJECT_REPOSITORY_INSTALLATION_REQUIRED:
    'Install the GitHub app for this repository to continue.',
  PROJECT_CREATION_PUSH_ACCESS_REQUIRED:
    'You need push access to create a project from this repository.',
  DEPLOYMENT_ENVIRONMENT_NOT_FOUND: 'Deployment environment not found.',
  DEPLOYMENT_BRANCH_MISMATCH:
    'The selected branch does not match this environment.',
  DEPLOYMENT_SERVER_REQUIRED: 'Assign a server before deploying.',
  DEPLOYMENT_SERVER_OFFLINE:
    'Wait until the assigned server is connected before deploying.',
  DEPLOYMENT_AGENT_UPDATE_REQUIRED:
    'Update the assigned server agent before deploying.',
  DEPLOYMENT_GITHUB_INSTALLATION_REQUIRED:
    'Connect a GitHub App installation before deploying.',
  DEPLOYMENT_COMMIT_UNAVAILABLE:
    'The selected commit is not available on this branch.',
  DEPLOYMENT_NOT_FOUND: 'Deployment not found.',
  DEPLOYMENT_ROLLBACK_UNSUCCESSFUL:
    'Only successful deployments can be rolled back to.',
  DEPLOYMENT_CONFIG_INVALID: 'Deployment config is invalid.',
  DEPLOYMENT_SERVER_NOT_FOUND: 'Deployment server not found.',
  DEPLOYMENT_SERVER_CHANGED:
    'This environment uses a different server now. Create a new deployment instead.',
  DEPLOYMENT_ROLLBACK_SERVER_OFFLINE:
    'Reconnect the deployment server before rolling back.',
  DEPLOYMENT_ROLLBACK_AGENT_UPDATE_REQUIRED:
    'Update the deployment server agent before rolling back.',
  DEPLOYMENT_ENVIRONMENT_INACTIVE:
    'Deployment environment is no longer active.',
  DEPLOYMENT_REDEPLOY_ACTIVE:
    'Queued or running deployments cannot be redeployed.',
  DEPLOYMENT_REDEPLOY_SERVER_OFFLINE:
    'Reconnect the deployment server before redeploying.',
  DEPLOYMENT_REDEPLOY_AGENT_UPDATE_REQUIRED:
    'Update the deployment server agent before redeploying.',
  PROJECT_REPOSITORY_MISSING: 'Project repository is not configured.',
  DEPLOYMENT_SERVER_DELETED:
    'Assigned server was deleted. Choose another server.',
  PROJECT_HOST_COMMANDS_FORBIDDEN:
    'Only team owners and admins can change host lifecycle commands.',
  PROJECT_HOST_COMMAND_SOURCE_FORBIDDEN:
    'Only team owners and admins can change the source of host lifecycle commands.',
  PROJECT_NAME_CONFLICT: 'Project names must be unique within a team.',
  PROJECT_DELETE_FORBIDDEN: 'Only team owners and admins can delete projects.',
  PROJECT_DELETE_CONFIRMATION: 'Type the project name to confirm deletion.',
  PROJECT_ACCESS_CHANGED: 'Project not found or access changed.',
  PROJECT_ROUTE_ENVIRONMENT_INVALID:
    'Select a valid environment for every scoped route.',
  PROJECT_ROUTE_DUPLICATED:
    'Each route path can only be configured once per scope.',
  PROJECT_DOMAIN_ENVIRONMENT_INVALID:
    'Select a valid environment for every domain.',
  PROJECT_DOMAIN_DUPLICATED: 'Each domain can only be added once.',
  PROJECT_GENERATED_ALIAS_PROTECTED:
    'A custom domain cannot replace a generated alias.',
  PROJECT_DOMAIN_NOT_FOUND: 'Domain not found.',
  PROJECT_REPOSITORY_INSTALLATION_REQUIRED_SELECTION:
    'Select a GitHub App installation for this repository.',
  PROJECT_REPOSITORY_GITHUB_REQUIRED:
    'Connect GitHub before changing the repository.',
  PROJECT_REPOSITORY_PUSH_ACCESS_REQUIRED:
    'You need push access to use this repository.',
  PROJECT_COMPOSE_PATH_REQUIRED:
    'Set a Compose file path before changing repositories.',
  PROJECT_PRODUCTION_ENVIRONMENT_REQUIRED:
    'Production environment is required.',
  PROJECT_ACTIVE_ENVIRONMENT_REQUIRED:
    'Project requires an active environment.',
  PROJECT_ENVIRONMENT_SERVER_INVALID:
    'Select a valid server for every environment.',
  PROJECT_ENVIRONMENT_SERVER_DUPLICATED:
    'Each environment can only have one server assignment.',
  PROJECT_DEFAULT_SERVER_INVALID: 'Select a valid default server.',
  PROJECT_SERVER_ASSIGNMENT_INVALID: 'Select a valid environment and server.',
  PROJECT_VARIABLE_DUPLICATED:
    'Environment variable keys must be unique per environment.',
  PROJECT_VARIABLE_ENVIRONMENT_INVALID:
    'Select a valid environment for every variable.',
  BACKUP_SCHEDULE_INVALID:
    'Backup schedules must use a five-field cron expression.',
  PROJECT_NOT_FOUND: 'Project not found.',
  PROJECT_SERVER_ADDRESS_INVALID:
    'The assigned server has no valid IP address for generating its nip.io URL.',
  PROJECT_RUNTIME_CONFIG_INVALID: 'Project runtime configuration is invalid.',
  BACKUP_NAME_REQUIRED: 'Backup name is required.',
  BACKUP_POLICY_REQUIRED:
    'Choose a backup policy when the environment has multiple enabled policies.',
  BACKUP_SETTINGS_CONFLICT:
    'Backup settings changed while you were editing, or your access changed. Reload before saving again.',
  BACKUP_ENVIRONMENT_INVALID: 'Select a valid backup environment.',
  BACKUP_POLICY_NOT_FOUND: 'Backup policy not found.',
  BACKUP_ALREADY_ACTIVE:
    'A backup is already queued or running for this environment.',
  BACKUP_MANAGEMENT_FORBIDDEN:
    'Only team owners and admins can configure backups or restore data.',
  BACKUPS_DISABLED: 'Backups are not enabled for this installation.',
  ACCOUNT_NOT_FOUND: 'User not found.',
  TEAM_NOT_FOUND: 'Team not found',
  TEAM_NAME_REQUIRED: 'Team name is required.',
  TEAM_SLUG_RESERVED: 'This slug is reserved.',
  TEAM_SLUG_CONFLICT: 'A team with this slug already exists.',
  TEAM_INVITE_EMAIL_REQUIRED: 'Enter at least one email address.',
  TEAM_INVITE_NOT_FOUND: 'Invite not found.',
  TEAM_MEMBER_NOT_FOUND: 'Member not found.',
  TEAM_OWNER_ROLE_FORBIDDEN: 'Only team owners can manage owner roles.',
  TEAM_OWNER_REMOVAL_FORBIDDEN: 'Only team owners can remove owners.',
  TEAM_LAST_OWNER: 'There must be at least one owner.',
  TEAM_MEMBERSHIP_CHANGED: 'Team membership changed. Try again.',
  TEAM_SETTINGS_CHANGED:
    'Team settings or your access changed. Reload and try again.',
  TEAM_TRANSFER_MEMBER_REQUIRED:
    'Choose another member to transfer ownership to.',
  TEAM_TRANSFER_FORBIDDEN: 'Only team owners can transfer ownership.',
  TEAM_MEMBER_ALREADY_OWNER: 'Member is already an owner.',
  TEAM_DELETE_CONFIRMATION: 'Type the team name to confirm deletion.',
  TEAM_DEFAULT_DELETE_FORBIDDEN: 'You cannot delete a default team.',
  TEAM_STATE_CHANGED: 'Team changed or became a default team. Try again.',
  TEAM_INVITATION_INVALID: 'Invalid or expired invitation.',
  TEAM_INVITATION_EMAIL_MISMATCH:
    'Sign in with the invited email address to accept.',
  TEAM_INVITATION_EMAIL_UNVERIFIED:
    'Verify your email address before accepting this invite.',
  TEAM_EMAIL_REQUIRED: 'Email is required.',
  TEAM_MANAGEMENT_FORBIDDEN: 'You do not have permission to manage this team.',
  TEAM_MANAGER_REQUIRED: 'Only team owners and admins can manage this team.',
  TEAM_OWNER_REQUIRED: 'Only team owners can manage this team.',
  TEAM_SLUG_INVALID:
    'Team slugs can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
  TEAM_ALREADY_MEMBER: 'This email address is already a member of this team.',
  TEAM_INVITATION_ALREADY_SENT:
    'An invitation has already been sent to this email address.',
  ACCOUNT_NAME_REQUIRED: 'Name is required.',
  ACCOUNT_USERNAME_CONFLICT: 'Username is already taken.',
  AUTH_ACCOUNT_NOT_FOUND: 'Account not found.',
  ACCOUNT_LAST_SIGN_IN_METHOD:
    'Connect another sign-in method before disconnecting this account.',
  ACCOUNT_DEFAULT_TEAM_LEAVE_FORBIDDEN: 'You cannot leave your default team.',
  ACCOUNT_MEMBERSHIP_NOT_FOUND: 'Team membership not found.',
  ACCOUNT_DELETE_CONFIRMATION: 'Type the account email to confirm deletion.',
  ACCOUNT_STATE_CHANGED: 'Account or team ownership changed. Try again.',
  ACCOUNT_USERNAME_REQUIRED: 'Username is required.',
  ACCOUNT_USERNAME_TOO_LONG: 'Username must be 50 characters or fewer.',
  ACCOUNT_USERNAME_INVALID:
    'Username must start and end with a letter or number and only use letters, numbers, dots, underscores hyphens.',
  ACCOUNT_OWNERSHIP_TRANSFER_REQUIRED:
    'Transfer ownership of teams where you are the only owner before deleting your account.',
  BACKUP_ENABLED_CONFIG_NOT_FOUND: 'Enabled backup configuration not found.',
  BACKUP_SERVER_REQUIRED: 'Backup environment is not assigned to a server.',
  BACKUP_MONGODB_AGENT_UPDATE_REQUIRED:
    'Update the server agent before running MongoDB backups.',
  BACKUP_CREDENTIALS_MISSING: 'Remote backup credentials are not configured.',
  BACKUP_RESTORE_ARTIFACT_REQUIRED:
    'Select at least one backup artifact to restore.',
  BACKUP_RUN_NOT_FOUND: 'Backup run not found.',
  BACKUP_NO_RECOVERABLE_ARTIFACTS: 'This backup has no recoverable artifacts.',
  BACKUP_SERVER_CHANGED:
    'Backup run is not assigned to the current environment server.',
  BACKUP_FAILED_REMOTE_RESTORE:
    'Only local artifacts from this failed backup can be restored.',
  BACKUP_ARTIFACT_NOT_FOUND: 'One or more backup artifacts were not found.',
  BACKUP_ARTIFACT_TYPE_MISMATCH:
    'Backup artifact type does not match the restore target.',
  BACKUP_DESTINATION_UNAVAILABLE:
    'The original remote backup destination is unavailable.',
  BACKUP_RESTORE_CREDENTIALS_MISSING:
    'Remote restore credentials are not configured.',
  BACKUP_ENVIRONMENT_NOT_FOUND: 'Backup environment not found.',
  BACKUP_DESTINATION_PREFIX_INVALID:
    'Backup destination prefixes cannot contain .. segments.',
  BACKUP_DATABASE_ENGINE_UNSUPPORTED:
    'This backup has no supported database engine metadata. Restore it manually.',
  BACKUP_STORAGE_NOT_FOUND: 'Backup storage not found.',
  BACKUP_STORAGE_SECRET_REQUIRED: 'Enter a secret access key.',
  BACKUP_STORAGE_LOCATION_IMMUTABLE:
    'Create another storage destination to change its bucket, region or endpoint.',
  BACKUP_STORAGE_REQUIRED: 'Select a workspace backup storage destination.',
  BACKUP_STORAGE_TEAM_MISMATCH:
    'Select a backup storage destination in this workspace.',
  BACKUP_STORAGE_IN_USE:
    'Storage cannot be removed while a policy, active backup or retained remote backup references it.',
  AVATAR_STORAGE_UNAVAILABLE:
    'Image uploads are not configured for this installation.',
  AVATAR_TYPE_UNSUPPORTED: 'Upload a PNG, JPEG, or WebP image.',
  AVATAR_TOO_LARGE: 'Avatars must be 2 MB or smaller.',
  AVATAR_CONTENT_MISMATCH: 'The uploaded file does not match its image type.',

  SERVER_NOT_FOUND: 'Server not found.',
  SERVER_NAME_CONFLICT: 'Server names must be unique within a team.',
  SERVER_DISABLE_CONFIRMATION: 'Type the server name to confirm disabling.',
  SERVER_DELETE_CONFIRMATION: 'Type the server name to confirm deletion.',
  SERVER_STATE_CHANGED: 'Server state or permissions changed. Try again.',
  SERVER_ENABLE_DISABLED_ONLY: 'Only disabled servers can be enabled.',
  SERVER_DISABLED_ENROLLMENT: 'Disabled servers cannot be enrolled.',
  SERVER_DELETED_ENROLLMENT: 'Deleted servers cannot be enrolled.',
  SERVER_CONNECTED_ENROLLMENT:
    'Connected servers cannot be re-enrolled. Disable the server first.',
  SERVER_ACCESS_CHANGED: 'Server not found or access changed.',
  SERVER_NAME_INVALID:
    'Server names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.',
  INVALID_INPUT: 'Check the entered values and try again.',
  UNAUTHORIZED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  INTERNAL_ERROR: 'Unable to complete this action. Please try again.',
} as const

export type PublicErrorCode = keyof typeof publicErrorMessages

function isSafeLocalUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !Array.from(value).some(
      (character) =>
        character === '\\' ||
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127,
    )
  )
}

// Server-function boundaries expose plain objects with registered public codes.
// Deliberate plugin refusals may attach public text; ordinary exceptions never do.
export class PublicError extends Error {
  readonly code: PublicErrorCode
  readonly policy?: { message: string; recoveryUrl?: string }
  readonly reloadUrl?: string
  constructor(
    code: PublicErrorCode,
    reloadUrl?: string,
    policy?: { message: string; recoveryUrl?: string },
  ) {
    super(publicErrorMessages[code])
    this.name = 'PublicError'
    this.code = code
    if (
      (code === 'WORKSPACE_RESTRICTED' || code === 'WORKSPACE_LIMIT_REACHED') &&
      policy &&
      typeof policy.message === 'string' &&
      policy.message.length > 0 &&
      policy.message.length <= 400
    ) {
      const recoveryUrl = policy.recoveryUrl
      this.policy = {
        message: policy.message,
        ...(isSafeLocalUrl(recoveryUrl) ? { recoveryUrl } : {}),
      }
      this.message = policy.message
    }
    if (isSafeLocalUrl(reloadUrl)) this.reloadUrl = reloadUrl
  }
}

export function getPublicErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown
      name?: unknown
      status?: unknown
      statusCode?: unknown
      message?: unknown
      policy?: { message?: unknown }
    }
    if (candidate.status === 429 || candidate.statusCode === 429)
      return 'Too many attempts. Please wait a moment and try again.'
    if (
      candidate.name === 'PublicError' &&
      typeof candidate.code === 'string' &&
      Object.hasOwn(publicErrorMessages, candidate.code)
    ) {
      if (
        (candidate.code === 'WORKSPACE_RESTRICTED' ||
          candidate.code === 'WORKSPACE_LIMIT_REACHED') &&
        typeof candidate.policy?.message === 'string' &&
        candidate.policy.message.length <= 400
      )
        return candidate.policy.message
      return candidate.code === 'INTERNAL_ERROR'
        ? fallback
        : publicErrorMessages[candidate.code as PublicErrorCode]
    }
    if (
      typeof candidate.message === 'string' &&
      /^(failed to fetch|fetch failed|load failed|networkerror\b|network request failed)/i.test(
        candidate.message,
      )
    )
      return 'Unable to connect. Check your connection and try again.'
  }
  return fallback
}

export function getPolicyRecoveryUrl(error: unknown): string | undefined {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    !['WORKSPACE_RESTRICTED', 'WORKSPACE_LIMIT_REACHED'].includes(
      String(error.code),
    ) ||
    !('policy' in error)
  )
    return
  const url = (error.policy as { recoveryUrl?: unknown } | undefined)
    ?.recoveryUrl
  return isSafeLocalUrl(url) ? url : undefined
}
