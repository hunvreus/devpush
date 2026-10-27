import { useState } from 'react'
import type { ComponentProps } from 'react'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
} from '#devpush/components/ui/combobox'

export function ComposeServiceInput({
  services,
  suggestionLabel = 'Choose Compose service',
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof ComboboxInput>, 'value' | 'onChange'> & {
  suggestionLabel?: string
  services: string[]
  value: string
  onValueChange: (service: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const known = [...new Set(services.filter(Boolean))]
  const items = value && !known.includes(value) ? [...known, value] : known
  return (
    <Combobox
      items={items}
      open={open}
      onOpenChange={setOpen}
      value={editing ? null : value || null}
      inputValue={value}
      disabled={props.disabled}
      onInputValueChange={(next, details) => {
        if (details.reason === 'input-change') {
          setEditing(true)
          onValueChange(next)
          setOpen(Boolean(next) || known.length > 0)
        }
      }}
      onValueChange={(next) => {
        setEditing(false)
        if (next !== null) onValueChange(next)
        setOpen(false)
      }}
    >
      <ComboboxInput {...props} />
      <ComboboxContent aria-label={suggestionLabel}>
        <ComboboxEmpty>
          No services found. Type a service name to use it.
        </ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {known.includes(item) ? item : `Use “${item}”`}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
