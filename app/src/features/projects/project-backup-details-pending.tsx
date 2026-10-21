import { ComposeServiceInput } from './compose-service-input'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '@/components/ui/field'
import { SettingsLayout } from '@/components/settings-layout'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlusIcon, SettingsIcon, TrashIcon } from 'lucide-react'
import {
  BackupPolicySection,
  RetentionFieldGroup,
} from './project-backup-policy'
import { backupDetailSections } from './project-backup-utils'

const ignore = () => {}
const footer = (
  <>
    <Button disabled variant="ghost">
      Cancel
    </Button>
    <Button disabled>Save</Button>
  </>
)

export function ProjectBackupDetailsPending({
  heading,
  canManage,
}: {
  heading: ReactNode
  canManage?: boolean
}) {
  return (
    <div
      className="space-y-8"
      aria-label="Loading backup policy"
      aria-busy="true"
    >
      {heading}
      <fieldset disabled>
        <SettingsLayout
          navigation={backupDetailSections
            .filter((section) => canManage !== false || section.id !== 'danger')
            .map((section) => ({
              href: `#${section.id}`,
              label: section.label,
              destructive: section.id === 'danger',
            }))}
        >
          <BackupPolicySection
            id="general"
            title="General"
            description="Name, environment, and schedule for this backup policy."
            footer={canManage !== false ? footer : undefined}
          >
            <FieldGroup>
              <Field orientation="horizontal">
                <Switch disabled aria-label="Enabled loading" />
                <FieldLabel>Enabled</FieldLabel>
              </Field>
              <PendingField label="Name (required)" />
              <PendingSelect label="Environment" />
              <Field>
                <FieldLabel>Schedule</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <PendingSelect label="Schedule preset" hideLabel />
                  <Input disabled aria-label="Backup schedule loading" />
                </div>
                <FieldDescription>Backup schedules use UTC.</FieldDescription>
              </Field>
            </FieldGroup>
          </BackupPolicySection>
          <BackupPolicySection
            id="destination"
            title="Remote backups"
            description="Upload backup artifacts to remote object storage."
            footer={canManage !== false ? footer : undefined}
          >
            <FieldGroup>
              <Field orientation="horizontal">
                <Switch disabled aria-label="Enable remote backups" />
                <FieldLabel>Enable remote backups</FieldLabel>
              </Field>
              <Field>
                <FieldLabel>Storage destination</FieldLabel>
                <ButtonGroup className="w-full">
                  <Select disabled>
                    <SelectTrigger
                      className="min-w-0 flex-1 w-auto"
                      aria-label="Storage destination"
                    >
                      <SelectValue placeholder="Select workspace storage" />
                    </SelectTrigger>
                  </Select>
                  {canManage !== false ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          disabled
                          variant="outline"
                          size="icon"
                          aria-label="Manage backup storage"
                        >
                          <SettingsIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Manage backup storage</TooltipContent>
                    </Tooltip>
                  ) : null}
                </ButtonGroup>
                <FieldDescription>
                  Owners and admins manage storage connections in workspace
                  settings.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </BackupPolicySection>
          <BackupPolicySection
            id="retention"
            title="Retention"
            description="Limits retained local and remote backup generations by count, age, and storage."
            footer={canManage !== false ? footer : undefined}
          >
            <div className="space-y-6">
              {(['Local', 'Remote'] as const).map((kind) => (
                <RetentionFieldGroup
                  key={kind}
                  title={`${kind} backups`}
                  description={
                    kind === 'Local'
                      ? 'Applies to backup files kept on the server. A value of 0 disables that local limit.'
                      : 'Applies to uploaded remote backup objects. A value of 0 disables that remote limit.'
                  }
                  count=""
                  days=""
                  maxStorageGb=""
                  fieldError={false}
                  onCountChange={ignore}
                  onDaysChange={ignore}
                  onMaxStorageGbChange={ignore}
                />
              ))}
            </div>
          </BackupPolicySection>
          {(['volumes', 'databases'] as const).map((kind) => (
            <BackupPolicySection
              key={kind}
              id={kind}
              title={kind === 'volumes' ? 'Volumes' : 'Databases'}
              description={
                kind === 'volumes'
                  ? 'Archive files from named Compose volumes. Use database backups for running databases.'
                  : 'Create engine-specific dumps from services. Leave Database blank to include all databases in that service. Credentials come from the service’s database environment variables.'
              }
              footer={canManage !== false ? footer : undefined}
            >
              <div
                className="space-y-4"
                aria-label={`${kind === 'volumes' ? 'Volumes' : 'Databases'} loading`}
              >
                {kind === 'volumes' ? (
                  <Field>
                    <FieldLabel>Volumes to back up</FieldLabel>
                    <Select disabled>
                      <SelectTrigger aria-label="Volumes to back up loading">
                        <Skeleton className="h-4 w-28" />
                      </SelectTrigger>
                    </Select>
                  </Field>
                ) : (
                  <>
                    <div>
                      <div
                        className={`grid gap-x-2 border-b pb-2 text-sm font-medium grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2.5rem]`}
                      >
                        <span>Service</span>
                        <div className="grid grid-cols-2 gap-x-2">
                          <span>Engine</span>
                          <span>Database</span>
                        </div>
                        <span />
                      </div>
                      <div
                        className={`grid items-start gap-x-2 border-b py-2 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2.5rem]`}
                      >
                        <ComposeServiceInput
                          disabled
                          services={[]}
                          value=""
                          onValueChange={ignore}
                          aria-label="Service loading"
                        />
                        <div className="grid grid-cols-2 gap-x-2">
                          <Select disabled>
                            <SelectTrigger aria-label="Engine loading">
                              <Skeleton className="h-4 w-24" />
                            </SelectTrigger>
                          </Select>
                          <Input disabled aria-label="Database loading" />
                        </div>
                        <Button
                          disabled
                          variant="destructive"
                          size="icon"
                          aria-label="Remove database"
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </div>
                    <Button disabled variant="outline">
                      <PlusIcon />
                      Add database
                    </Button>
                  </>
                )}
              </div>
            </BackupPolicySection>
          ))}
          {canManage !== false ? (
            <BackupPolicySection
              id="danger"
              title="Danger"
              description="Delete this backup policy. Existing backup runs are kept."
            >
              <Button disabled variant="destructive">
                <TrashIcon data-icon="inline-start" />
                Delete policy
              </Button>
            </BackupPolicySection>
          ) : null}
        </SettingsLayout>
      </fieldset>
    </div>
  )
}

function PendingField({
  label,
  description,
}: {
  label: string
  description?: string
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <Input disabled aria-label={`${label} loading`} />
    </Field>
  )
}
function PendingSelect({
  label,
  hideLabel = false,
}: {
  label: string
  hideLabel?: boolean
}) {
  return (
    <Field>
      {hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
      <Select disabled>
        <SelectTrigger className="w-full" aria-label={`${label} loading`}>
          <SelectValue placeholder={<Skeleton className="h-4 w-24" />} />
        </SelectTrigger>
      </Select>
    </Field>
  )
}
