import { useState } from 'react'
import { useProfileOnboarding, hasPlanOnboarding } from '#devpush/deployment/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { ArrowRightIcon, LoaderCircleIcon } from 'lucide-react'
import { ProfilePicture } from '@/features/users/profile-picture'
import { useAvatarInput } from '@/lib/use-avatar-input'
import { getErrorMessage } from '@/lib/error-message'
import { onboardingDestination, shouldOfferPlan } from '@/lib/onboarding'
import { confirmProfile } from '@/server/users/onboarding'
import type { AuthUserContext } from '@/server/auth/context'

export function ProfileOnboarding({
  context,
  destination,
}: {
  context: NonNullable<AuthUserContext>
  destination?: string
}) {
  const { user, defaultTeam } = context
  const [name, setName] = useState(user.name)
  const [version, setVersion] = useState(user.settingsVersion)
  const [removed, setRemoved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const avatar = useAvatarInput()
  const extra = useProfileOnboarding({ userId: user.id })
  const image = removed ? null : (avatar.dataUrl ?? user.image)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || avatar.pending) return
    setBusy(true)
    setError('')
    try {
      const saved = await confirmProfile({
        data: {
          settingsVersion: version,
          name,
          username: user.username,
          avatarDataUrl: avatar.dataUrl,
          deleteAvatar: removed,
        },
      })
      setVersion(saved.settingsVersion)
      await extra.complete()
      const next = onboardingDestination(destination, defaultTeam.slug)
      const plans =
        hasPlanOnboarding() &&
        context.invites.length === 0 &&
        shouldOfferPlan(next, defaultTeam.slug, defaultTeam.role)
      window.location.assign(
        plans ? `/onboarding/plans?redirect=${encodeURIComponent(next)}` : next,
      )
    } catch (cause) {
      setError(getErrorMessage(cause, 'Unable to save your profile.'))
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4 md:p-6">
      <form
        className="w-full max-w-sm"
        aria-label="Confirm your details"
        onSubmit={(event) => void submit(event)}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Confirm your details</h1>
            </CardTitle>
            <CardDescription>
              Check your name and picture before you continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field orientation="horizontal" className={fieldClassName}>
              <FieldLabel htmlFor="profile-picture">Picture</FieldLabel>
              <ProfilePicture
                image={image}
                name={name}
                email={user.email}
                disabled={busy}
                processing={avatar.pending}
                onChange={(value) => {
                  setRemoved(value === null)
                  avatar.setDataUrl(value === user.image ? null : value)
                }}
                onFile={async (file) => {
                  setError('')
                  if (
                    !['image/png', 'image/jpeg', 'image/webp'].includes(
                      file.type,
                    )
                  ) {
                    setError('Upload a PNG, JPEG, or WebP image.')
                    return
                  }
                  if (file.size > 2 * 1024 * 1024) {
                    setError('Avatars must be 2 MB or smaller.')
                    return
                  }
                  try {
                    await avatar.read(file)
                    setRemoved(false)
                  } catch (cause) {
                    setError(getErrorMessage(cause, 'Unable to read picture.'))
                  }
                }}
              />
            </Field>
            <Field orientation="horizontal" className={fieldClassName}>
              <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
              <Input
                id="profile-name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={256}
                disabled={busy}
              />
            </Field>
            <Field orientation="horizontal" className={fieldClassName}>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                id="profile-email"
                className="text-muted-foreground"
                value={user.email}
                readOnly
                type="email"
              />
            </Field>
            {extra.fields}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="justify-end">
            <Button disabled={busy || avatar.pending || !name.trim()}>
              Continue
              {busy ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-end"
                />
              ) : (
                <ArrowRightIcon data-icon="inline-end" />
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </main>
  )
}
const fieldClassName = 'grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3'
