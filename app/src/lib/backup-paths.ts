export function getDefaultBackupPrefix(
  projectId: string,
  environmentId: string,
  backupId: string,
) {
  return `projects/${projectId}/environments/${environmentId}/backups/${backupId}`
}
