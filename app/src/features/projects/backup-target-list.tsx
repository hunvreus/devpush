import { ArchiveIcon, DatabaseIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import {
  backupDatabaseEngines,
  type BackupDatabase,
} from '@/lib/backup-database'
import type { ProjectBackupConfig } from '@/server/projects/types'
import type { FormErrors } from '@/lib/form-errors'

type Volumes = ProjectBackupConfig['volumes']
type Dumps = ProjectBackupConfig['databaseDumps']
export function BackupTargetList({
  volumes,
  dumps,
  volumeOptions,
  serviceOptions,
  onVolumesChange,
  onDumpsChange,
  errors,
}: {
  volumes: Volumes
  dumps: Dumps
  volumeOptions: string[]
  serviceOptions: string[]
  onVolumesChange: (value: Volumes) => void
  onDumpsChange: (value: Dumps) => void
  errors: FormErrors
}) {
  const volumeRows =
    volumes.mode === 'allNamed'
      ? ['__all_named__']
      : volumes.mode === 'selected'
        ? volumes.names
        : []
  function removeVolume(index: number) {
    const names = volumeRows.filter((_, i) => i !== index)
    onVolumesChange({ mode: names.length ? 'selected' : 'none', names })
  }
  function addVolume() {
    onVolumesChange({
      mode: 'selected',
      names: [
        ...volumeRows,
        volumeOptions.find((v) => !volumeRows.includes(v)) ?? '',
      ],
    })
  }
  function addDump() {
    onDumpsChange([
      ...dumps,
      { service: serviceOptions[0] ?? '', engine: 'postgres', database: '' },
    ])
  }
  return (
    <div className="space-y-4">
      {volumeRows.length + dumps.length === 0 ? (
        <Empty className="min-h-40 border-0">
          <EmptyHeader>
            <EmptyTitle>No backup targets.</EmptyTitle>
            <EmptyDescription>
              Add a Compose volume or a database dump to this policy.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y">
          {volumeRows.map((volume, index) => (
            <li
              key={`volume-${index}`}
              className="grid items-start gap-4 py-4 md:grid-cols-[180px_180px_minmax(0,1fr)_2rem]"
            >
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select
                  value="volume"
                  onValueChange={() => {
                    removeVolume(index)
                    addDump()
                  }}
                >
                  <SelectTrigger aria-label="Backup target type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="volume">
                      <ArchiveIcon className="size-4 shrink-0" />
                      Volume
                    </SelectItem>
                    <SelectItem value="database">
                      <DatabaseIcon className="size-4 shrink-0" />
                      Database
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Compose volume</FieldLabel>
                <Select
                  value={volume || undefined}
                  onValueChange={(name) => {
                    if (name === '__all_named__') {
                      onVolumesChange({ mode: 'allNamed', names: [] })
                    } else {
                      const names = [...volumeRows]
                      names[index] = name
                      onVolumesChange({ mode: 'selected', names })
                    }
                  }}
                >
                  <SelectTrigger aria-label="Compose volume">
                    <SelectValue placeholder="Select volume" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="__all_named__"
                      disabled={volumeRows.length > 1}
                    >
                      All named volumes
                    </SelectItem>
                    {volumeOptions.filter(Boolean).map((name) => (
                      <SelectItem
                        key={name}
                        value={name}
                        disabled={volumeRows.some(
                          (v, i) => v === name && i !== index,
                        )}
                      >
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="space-y-2 pt-0 text-sm text-muted-foreground md:pt-7">
                <p>
                  Archive files from{' '}
                  {volume === '__all_named__'
                    ? 'each named Compose volume'
                    : volume || 'the selected volume'}
                  .
                </p>
                <p>
                  Files may change during a live backup. Use a database dump for
                  running databases.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:mt-7"
                aria-label="Remove volume target"
                onClick={() => removeVolume(index)}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
          {dumps.map((dump, index) => (
            <li
              key={`dump-${index}`}
              className="grid items-start gap-4 py-4 md:grid-cols-[180px_180px_minmax(0,1fr)_2rem]"
            >
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select
                  value="database"
                  onValueChange={() => {
                    onDumpsChange(dumps.filter((_, i) => i !== index))
                    if (volumes.mode !== 'allNamed') addVolume()
                  }}
                >
                  <SelectTrigger aria-label="Backup target type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="volume"
                      disabled={volumes.mode === 'allNamed'}
                    >
                      <ArchiveIcon className="size-4 shrink-0" />
                      Volume
                    </SelectItem>
                    <SelectItem value="database">
                      <DatabaseIcon className="size-4 shrink-0" />
                      Database
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Compose service</FieldLabel>
                <Select
                  value={dump.service || undefined}
                  onValueChange={(service) =>
                    onDumpsChange(
                      dumps.map((d, i) =>
                        i === index ? { ...d, service } : d,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label="Database service"
                    data-validation-field={`databaseDumps.${index}.service`}
                    aria-invalid={Boolean(
                      errors[`databaseDumps.${index}.service`],
                    )}
                  >
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceOptions.filter(Boolean).map((service) => (
                      <SelectItem key={service} value={service}>
                        {service}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>
                  {errors[`databaseDumps.${index}.service`]}
                </FieldError>
              </Field>
              <div className="space-y-3">
                <div className="grid gap-4 xl:grid-cols-2">
                  <Field>
                    <FieldLabel>Database engine</FieldLabel>
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
                    <FieldLabel htmlFor={`backup-database-${index}`}>
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
                <FieldDescription>
                  {dump.engine === 'needs_configuration'
                    ? 'This policy was paused because its custom command could not be converted. Select an engine and database, then enable the policy when ready.'
                    : `Leave Database blank to back up all databases. Credentials come from the container’s ${dump.engine === 'postgres' ? 'POSTGRES_USER and POSTGRES_PASSWORD' : dump.engine === 'mysql' ? 'MYSQL_ROOT_PASSWORD' : dump.engine === 'mariadb' ? 'MARIADB_ROOT_PASSWORD (or MYSQL_ROOT_PASSWORD)' : 'MONGO_INITDB_ROOT_USERNAME and MONGO_INITDB_ROOT_PASSWORD'} variables.`}
                </FieldDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:mt-7"
                aria-label="Remove database dump"
                onClick={() =>
                  onDumpsChange(dumps.filter((_, i) => i !== index))
                }
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FieldError>
        {Object.entries(errors)
          .filter(([key]) => key.startsWith('volumes.'))
          .map(([, message]) => message)
          .join(' ')}
      </FieldError>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">
            <PlusIcon data-icon="inline-start" />
            Add target
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            disabled={
              volumes.mode === 'allNamed' ||
              volumeOptions.filter(Boolean).every((v) => volumeRows.includes(v))
            }
            onSelect={addVolume}
          >
            <ArchiveIcon />
            Volume
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={serviceOptions.length === 0}
            onSelect={addDump}
          >
            <DatabaseIcon />
            Database
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
