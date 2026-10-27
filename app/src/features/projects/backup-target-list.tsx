import { BackupVolumePicker } from './backup-volume-picker'
import { ProjectSettingsActionTooltip } from './project-settings-section'
import { ComposeServiceInput } from './compose-service-input'
import { PlusIcon, TrashIcon } from 'lucide-react'
import { Button } from '#devpush/components/ui/button'
import { Field, FieldLabel, FieldError } from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#devpush/components/ui/select'
import {
  Empty,
  EmptyHeader,
  EmptyContent,
  EmptyTitle,
  EmptyDescription,
} from '#devpush/components/ui/empty'
import { backupDatabaseEngines } from '#devpush/lib/backup-database'
import type { BackupDatabase } from '#devpush/lib/backup-database'
import type { ProjectBackupConfig } from '#devpush/server/projects/types'
import type { FormErrors } from '#devpush/lib/form-errors'

type Volumes = ProjectBackupConfig['volumes']
type Dumps = ProjectBackupConfig['databaseDumps']
export function BackupTargetList({
  kind,
  volumes,
  dumps,
  volumeOptions,
  serviceOptions,
  onVolumesChange,
  onDumpsChange,
  errors,
}: {
  kind: 'volumes' | 'databases'
  volumes: Volumes
  dumps: Dumps
  volumeOptions: string[]
  serviceOptions: string[]
  onVolumesChange: (value: Volumes) => void
  onDumpsChange: (value: Dumps) => void
  errors: FormErrors
}) {
  function addDump() {
    onDumpsChange([...dumps, { service: '', engine: 'postgres', database: '' }])
  }
  const visibleDumps = kind === 'databases' ? dumps : []
  const empty = visibleDumps.length === 0
  const addAction = (
    <Button type="button" variant="outline" onClick={addDump}>
      <PlusIcon data-icon="inline-start" />
      {kind === 'volumes' ? 'Add volume' : 'Add database'}
    </Button>
  )
  if (kind === 'volumes')
    return (
      <div className="space-y-4">
        <BackupVolumePicker
          value={volumes}
          options={volumeOptions}
          onValueChange={onVolumesChange}
        />
        <FieldError>
          {Object.entries(errors)
            .filter(([key]) => key.startsWith('volumes.'))
            .map(([, message]) => message)
            .join(' ')}
        </FieldError>
      </div>
    )
  return (
    <div className="space-y-4">
      {empty ? (
        <Empty className="border-0 p-0 py-6">
          <EmptyHeader>
            <EmptyTitle>No {kind}.</EmptyTitle>
            <EmptyDescription>
              Add a database backup to this policy.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addAction}</EmptyContent>
        </Empty>
      ) : (
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
          <ul>
            {visibleDumps.map((dump, index) => (
              <li
                key={`dump-${index}`}
                className="grid items-start gap-x-2 border-b py-2 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2.5rem]"
              >
                <Field>
                  <FieldLabel className="sr-only">Service</FieldLabel>
                  <ComposeServiceInput
                    services={serviceOptions}
                    value={dump.service}
                    placeholder="Service name"
                    aria-label="Database service"
                    data-validation-field={`databaseDumps.${index}.service`}
                    aria-invalid={Boolean(
                      errors[`databaseDumps.${index}.service`],
                    )}
                    onValueChange={(service) =>
                      onDumpsChange(
                        dumps.map((d, i) =>
                          i === index ? { ...d, service } : d,
                        ),
                      )
                    }
                  />
                  <FieldError>
                    {errors[`databaseDumps.${index}.service`]}
                  </FieldError>
                </Field>
                <div className="space-y-3">
                  <div className="grid gap-x-2 grid-cols-2">
                    <Field>
                      <FieldLabel className="sr-only">Engine</FieldLabel>
                      <Select
                        value={dump.engine}
                        onValueChange={(engine) =>
                          onDumpsChange(
                            dumps.map((d, i) =>
                              i === index
                                ? {
                                    service: d.service,
                                    database: d.database,
                                    engine: engine as BackupDatabase['engine'],
                                  }
                                : d,
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          aria-label="Database engine"
                          data-validation-field={`databaseDumps.${index}.engine`}
                          aria-invalid={Boolean(
                            errors[`databaseDumps.${index}.engine`],
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dump.engine === 'needs_configuration' ? (
                            <SelectItem value="needs_configuration" disabled>
                              Select engine
                            </SelectItem>
                          ) : null}
                          {backupDatabaseEngines.map((engine) => (
                            <SelectItem key={engine.value} value={engine.value}>
                              {engine.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError>
                        {errors[`databaseDumps.${index}.engine`]}
                      </FieldError>
                    </Field>
                    <Field>
                      <FieldLabel
                        className="sr-only"
                        htmlFor={`backup-database-${index}`}
                      >
                        Database
                      </FieldLabel>
                      <Input
                        id={`backup-database-${index}`}
                        value={dump.database}
                        placeholder="All databases"
                        maxLength={128}
                        data-validation-field={`databaseDumps.${index}.database`}
                        aria-invalid={Boolean(
                          errors[`databaseDumps.${index}.database`],
                        )}
                        onChange={(event) =>
                          onDumpsChange(
                            dumps.map((d, i) =>
                              i === index
                                ? { ...d, database: event.target.value }
                                : d,
                            ),
                          )
                        }
                      />
                      <FieldError>
                        {errors[`databaseDumps.${index}.database`]}
                      </FieldError>
                    </Field>
                  </div>
                </div>
                <ProjectSettingsActionTooltip label="Remove database">
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label="Remove database dump"
                    onClick={() =>
                      onDumpsChange(dumps.filter((_, i) => i !== index))
                    }
                  >
                    <TrashIcon />
                  </Button>
                </ProjectSettingsActionTooltip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!empty ? addAction : null}
    </div>
  )
}
