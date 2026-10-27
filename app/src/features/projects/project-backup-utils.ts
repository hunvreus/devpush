import { buildRuntimeId } from '#devpush/lib/runtime-id'
import type {
  ProjectBackupArtifact,
  ProjectBackupConfig,
  ProjectBackupRun,
  ProjectBackupRestore,
} from '#devpush/server/projects/types'

export type BackupFilters = {
  policy?: string
  environment?: string
  server?: string
  status?: string
  type?: string
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

export function getLatestBackupRuns(runs: ProjectBackupRun[]) {
  const latest = new Map<string, ProjectBackupRun>()
  for (const run of runs) {
    if (!run.configId) continue
    const previous = latest.get(run.configId)
    if (
      !previous ||
      run.createdAt > previous.createdAt ||
      (run.createdAt === previous.createdAt && run.id > previous.id)
    )
      latest.set(run.configId, run)
  }
  return latest
}

export function getBackupActivity(
  runs: ProjectBackupRun[],
  restores: ProjectBackupRestore[],
  filters: BackupFilters,
  now = new Date(),
) {
  const since = getSinceDate(filters.time, now)
  return [
    ...runs.map((run) => ({
      type: 'backup' as const,
      record: run,
      source: run,
    })),
    ...restores.map((restore) => ({
      type: 'restore' as const,
      record: restore,
      source: runs.find((run) => run.id === restore.backupRunId),
    })),
  ]
    .filter(
      ({ type, record, source }) =>
        (!filters.policy || source?.configId === filters.policy) &&
        (!filters.type || filters.type === type) &&
        (!filters.environment ||
          record.environmentId === filters.environment) &&
        (!filters.status || record.status === filters.status) &&
        (!filters.server || record.serverId === filters.server) &&
        (!since || new Date(record.startedAt ?? record.createdAt) >= since),
    )
    .sort(
      (a, b) =>
        new Date(b.record.startedAt ?? b.record.createdAt).getTime() -
        new Date(a.record.startedAt ?? a.record.createdAt).getTime(),
    )
}

export function formatBackupAge(value: string, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.round((now - new Date(value).getTime()) / 60000),
  )
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function formatBackupUtc(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(value))
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

function inferArtifactName(artifact: ProjectBackupArtifact) {
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

export const backupDetailSections = [
  { id: 'general', label: 'General' },
  { id: 'destination', label: 'Remote backups' },
  { id: 'retention', label: 'Retention' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'databases', label: 'Databases' },
  { id: 'danger', label: 'Danger' },
]

export function getComposeArtifactName(
  artifact: ProjectBackupArtifact,
  projectId: string,
  environmentId: string,
) {
  const name = inferArtifactName(artifact)
  return artifact.type === 'volume'
    ? getComposeVolumeName(name, projectId, environmentId)
    : name
}

export function getComposeVolumeName(
  name: string,
  projectId: string,
  environmentId: string,
) {
  const prefix = buildRuntimeId({ projectId, environmentId }) + '_'
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}
