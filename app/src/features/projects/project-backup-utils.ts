import { isValidCron } from '@/server/backups/cron'
import type {
  ProjectBackupArtifact,
  ProjectBackupConfig,
  ProjectBackupRun,
} from '@/server/projects/types'

export type BackupFilters = {
  environment?: string
  server?: string
  status?: string
  time?: string
}

export const backupCronPresets = [
  { label: 'Daily at 02:00 UTC', value: '0 2 * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Weekly on Sunday (UTC)', value: '0 2 * * 0' },
  { label: 'Monthly on the 1st (UTC)', value: '0 2 1 * *' },
]

export function getSchedulePresetValue(cron: string) {
  return backupCronPresets.some((preset) => preset.value === cron)
    ? cron
    : 'custom'
}

export function filterBackupRuns(
  runs: Array<ProjectBackupRun>,
  filters: BackupFilters,
  now = new Date(),
) {
  const since = getSinceDate(filters.time, now)
  return runs.filter(
    (run) =>
      (!filters.environment || run.environmentId === filters.environment) &&
      (!filters.server || run.serverId === filters.server) &&
      (!filters.status || run.status === filters.status) &&
      (!since || new Date(run.createdAt) >= since),
  )
}

export function getSinceDate(time: string | undefined, now = new Date()) {
  const days = time === '24h' ? 1 : time === '7d' ? 7 : time === '30d' ? 30 : 0
  if (!days) {
    return null
  }
  const date = new Date(now)
  date.setDate(date.getDate() - days)
  return date
}

export function formatBackupSchedule(
  schedule: ProjectBackupConfig['schedule'],
) {
  return (
    backupCronPresets.find((preset) => preset.value === schedule.cron)?.label ??
    schedule.cron
  )
}

export function formatBackupStatus(status: ProjectBackupRun['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function formatBackupDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatBackupArtifacts(
  artifacts: ProjectBackupRun['artifacts'],
) {
  if (artifacts.length === 0) {
    return 'No artifacts'
  }
  const files = artifacts.filter((artifact) => artifact.type !== 'manifest')
  const volumes = new Set(
    files
      .filter((a) => a.type === 'volume')
      .map((a) => a.objectKey.split('/').at(-1)),
  ).size
  const dumps = new Set(
    files
      .filter((a) => a.type === 'database')
      .map((a) => a.objectKey.split('/').at(-1)),
  ).size
  const targets =
    [
      volumes ? `${volumes} volume${volumes === 1 ? '' : 's'}` : '',
      dumps ? `${dumps} dump${dumps === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'No backup files'
  const locations = [
    files.some((a) => a.storage === 'local') ? 'Server' : '',
    files.some((a) => a.storage === 'remote') ? 'Remote' : '',
  ]
    .filter(Boolean)
    .join(' + ')
  return locations ? `${targets} · ${locations}` : targets
}

export function inferArtifactName(artifact: ProjectBackupArtifact) {
  const fileName = artifact.objectKey.split('/').at(-1) ?? artifact.objectKey
  return fileName
    .replace(/^\d+-/, '')
    .replace(/\.(sql|archive)\.gz$/, '')
    .replace(/\.tar\.gz$/, '')
    .replace(/\.json$/, '')
}

export function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function getDefaultBackupPrefix(
  projectId: string,
  environmentId: string,
  backupId: string,
) {
  return `projects/${projectId}/environments/${environmentId}/backups/${backupId}`
}

export function getDatabaseServiceOptions({
  databaseDumps,
  services,
}: {
  databaseDumps: ProjectBackupConfig['databaseDumps']
  services: Array<string>
}) {
  return Array.from(
    new Set(
      [...services, ...databaseDumps.map((dump) => dump.service)]
        .map((service) => service.trim())
        .filter(Boolean),
    ),
  ).sort()
}

export function isValidRetention(retention: ProjectBackupConfig['retention']) {
  return [retention.local, retention.remote].every(
    (item) =>
      Number.isInteger(item.count) &&
      item.count >= 0 &&
      Number.isInteger(item.days) &&
      item.days >= 0 &&
      Number.isFinite(item.maxStorageGb) &&
      item.maxStorageGb >= 0,
  )
}

export function isCronSchedule(value: string) {
  return isValidCron(value)
}

export const backupDetailSections = [
  { id: 'general', label: 'General' },
  { id: 'destination', label: 'Remote backups' },
  { id: 'retention', label: 'Retention' },
  { id: 'targets', label: 'Backup targets' },
  { id: 'danger', label: 'Danger' },
]

export function getComposeArtifactName(
  artifact: ProjectBackupArtifact,
  projectId: string,
  environmentId: string,
) {
  const name = inferArtifactName(artifact)
  const prefix = `dp_${projectId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10)
    .padEnd(10, '0')}_${environmentId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10)
    .padEnd(10, '0')}_`
  return artifact.type === 'volume' && name.startsWith(prefix)
    ? name.slice(prefix.length)
    : name
}
