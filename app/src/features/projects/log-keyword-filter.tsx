import { useEffect, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'

export function LogKeywordFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = draft.trim()

      if (next !== value) {
        onChange(next || null)
      }
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [draft, onChange, value])

  return (
    <InputGroup className="w-48">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Find in logs"
        placeholder="Find in logs"
        type="text"
        value={draft}
      />
    </InputGroup>
  )
}
