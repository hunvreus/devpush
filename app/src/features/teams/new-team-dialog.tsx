import { hasWorkspaceOnboarding } from '#devpush/features/plugins/contributions'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { LoaderIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createTeamSchema } from '#devpush/lib/team-forms-schema'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { afterMutation } from '#devpush/lib/action-feedback'
import { createTeamAction } from '#devpush/server/teams/functions'
import { Button } from '#devpush/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#devpush/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'

export function NewTeamDialogLauncher({
  children,
  onCreated,
}: {
  children: (open: () => void) => ReactNode
  onCreated: (teamSlug: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  async function createTeam() {
    if (isCreating) return
    const parsed = createTeamSchema.safeParse({ name })
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Enter a team name.')
      document.getElementById('new-team-name')?.focus()
      return
    }
    setNameError(null)
    setFormError(null)
    setIsCreating(true)

    try {
      const team = await createTeamAction({ data: parsed.data })
      setName('')
      setOpen(false)
      toast.success('Team created.')
      if (hasWorkspaceOnboarding()) {
        window.location.assign(
          `/onboarding/workspace?team=${encodeURIComponent(team.slug)}`,
        )
        return
      }
      await afterMutation(
        () => onCreated(team.slug),
        'Team created, but opening it failed. Please reload.',
      )
    } catch (error) {
      setFormError(getPublicErrorMessage(error, 'Unable to create team.'))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isCreating) setOpen(next)
      }}
    >
      {children(() => setOpen(true))}
      <DialogContent>
        <form
          id="create-team-form"
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void createTeam()
          }}
        >
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
            <DialogDescription>
              Create a team to group projects, servers, and settings.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(nameError)}>
            <FieldLabel htmlFor="new-team-name">Name</FieldLabel>
            <Input
              aria-invalid={Boolean(nameError)}
              id="new-team-name"
              required
              maxLength={100}
              disabled={isCreating}
              aria-describedby="new-team-name-error"
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
            />
            <FieldError id="new-team-name-error">{nameError}</FieldError>
          </Field>
          <FieldError role="alert">{formError}</FieldError>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isCreating}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
