import { useState } from 'react'
import {
  Field,
  FieldLabel,
  FieldDescription,
} from '#devpush/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#devpush/components/ui/select'
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxValue,
  ComboboxContent,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
  useComboboxAnchor,
} from '#devpush/components/ui/combobox'
import { backupConfigSchema } from '#devpush/lib/backup-policy-schema'
import type { ProjectBackupConfig } from '#devpush/server/projects/types'

type Volumes = ProjectBackupConfig['volumes']
const modeLabels: Record<Volumes['mode'], string> = {
  none: 'No volumes',
  allNamed: 'All named volumes',
  selected: 'Selected volumes',
}
export function BackupVolumePicker({
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  value: Volumes
  options: string[]
  onValueChange: (value: Volumes) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const anchor = useComboboxAnchor()
  const known = [...new Set([...options, ...value.names].filter(Boolean))]
  const custom = query.trim()
  const items = custom && !known.includes(custom) ? [...known, custom] : known
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel>Volumes to back up</FieldLabel>
        <Select
          disabled={disabled}
          value={value.mode}
          onValueChange={(mode: Volumes['mode']) => {
            setQuery('')
            onValueChange({
              mode,
              names: mode === 'selected' ? value.names : [],
            })
          }}
        >
          <SelectTrigger aria-label="Volumes to back up">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {backupConfigSchema.shape.volumes.shape.mode.options.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {modeLabels[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {value.mode === 'selected' ? (
        <Field>
          <FieldLabel>Compose volumes</FieldLabel>
          <Combobox
            multiple
            items={items}
            value={value.names}
            inputValue={query}
            disabled={disabled}
            autoHighlight
            open={open}
            onOpenChange={setOpen}
            onInputValueChange={(next, details) => {
              setQuery(next)
              if (details.reason === 'input-change')
                setOpen(Boolean(next.trim()) || known.length > 0)
            }}
            onValueChange={(names: string[]) => {
              onValueChange({
                mode: 'selected',
                names: [
                  ...new Set(names.map((name) => name.trim()).filter(Boolean)),
                ],
              })
              setQuery('')
              setOpen(false)
            }}
          >
            <ComboboxChips ref={anchor}>
              <ComboboxValue>
                {(names: string[]) =>
                  names.map((name) => (
                    <ComboboxChip key={name} aria-label={`Volume ${name}`}>
                      {name}
                    </ComboboxChip>
                  ))
                }
              </ComboboxValue>
              <ComboboxChipsInput
                aria-label="Compose volumes"
                placeholder="Select or enter volume names"
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    !custom ||
                    event.currentTarget.getAttribute('aria-activedescendant')
                  )
                    return
                  event.preventDefault()
                  event.preventBaseUIHandler()
                  onValueChange({
                    mode: 'selected',
                    names: [...new Set([...value.names, custom])],
                  })
                  setQuery('')
                  setOpen(false)
                }}
              />
            </ComboboxChips>
            <ComboboxContent anchor={anchor}>
              <ComboboxEmpty>
                No volumes found. Type a volume name to add it.
              </ComboboxEmpty>
              <ComboboxList>
                {(name: string) => (
                  <ComboboxItem key={name} value={name}>
                    {known.includes(name) ? name : `Use “${name}”`}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldDescription>
            Select known volumes or type a name and press Enter to add it.
          </FieldDescription>
        </Field>
      ) : null}
    </div>
  )
}
