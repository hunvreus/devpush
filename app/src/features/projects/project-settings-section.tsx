import { LoaderIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '#devpush/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'

export function ProjectSettingsActionTooltip({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ProjectSettingsActions({
  hasChanges,
  isSaving,
  saveDisabled = false,
  form,
  onCancel,
  onSave,
}: {
  hasChanges: boolean
  isSaving: boolean
  saveDisabled?: boolean
  form?: string
  onCancel: () => void
  onSave: () => Promise<void>
}) {
  return (
    <>
      <Button
        variant="ghost"
        type="button"
        onClick={onCancel}
        disabled={!hasChanges || isSaving}
      >
        Cancel
      </Button>
      <Button
        type={form ? 'submit' : 'button'}
        form={form}
        onClick={form ? undefined : () => void onSave()}
        disabled={!hasChanges || isSaving || saveDisabled}
      >
        {isSaving ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Save
      </Button>
    </>
  )
}
