import { LoaderIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function ProjectSettingsSection({
  title,
  description,
  children,
  footer,
  id,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  id: string
}) {
  return (
    <Card id={id} className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? (
        <CardFooter className="justify-end gap-x-2">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}

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
  onCancel,
  onSave,
}: {
  hasChanges: boolean
  isSaving: boolean
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
        type="button"
        onClick={() => void onSave()}
        disabled={!hasChanges || isSaving}
      >
        {isSaving ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Save
      </Button>
    </>
  )
}
