import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#devpush/components/ui/card'
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '#devpush/components/ui/field'
import { Switch } from '#devpush/components/ui/switch'
import { Checkbox } from '#devpush/components/ui/checkbox'
import { Button } from '#devpush/components/ui/button'
import {
  notificationCategories,
  defaultNotificationPreferences,
} from '#devpush/lib/notification-preferences'
import type { NotificationScope } from '#devpush/lib/notification-preferences'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  getNotificationMute,
  updateNotificationMute,
} from '#devpush/server/notifications/functions'
import { useEmailPreferenceContributions } from '#devpush/features/plugins/contributions'

type Preferences = typeof defaultNotificationPreferences
export function AccountEmailPreferences({ userId }: { userId: string }) {
  const client = useQueryClient()
  const key = ['notification-preferences', userId]
  const query = useQuery({
    queryKey: key,
    queryFn: () => getNotificationPreferences(),
  })
  const [draft, setDraft] = useState<{
    preferences: Preferences
    version: number
  } | null>(null)
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const extra = useEmailPreferenceContributions({ userId })
  const value =
    draft?.preferences ??
    query.data?.preferences ??
    defaultNotificationPreferences
  const dirty = Boolean(
    draft &&
    JSON.stringify(draft.preferences) !==
      JSON.stringify(query.data?.preferences),
  )
  const busy = pending || extra.pending
  async function save() {
    if (saving.current || busy || (!dirty && !extra.dirty)) return
    saving.current = true
    setPending(true)
    try {
      if (dirty && draft) {
        const saved = await updateNotificationPreferences({ data: draft })
        client.setQueryData(key, saved)
        setDraft(null)
      }
      if (extra.dirty) await extra.save()
      toast.success('Email preferences saved.')
    } catch {
      toast.error(
        'Unable to save email preferences. Reload if they changed elsewhere.',
      )
    } finally {
      saving.current = false
      setPending(false)
    }
  }
  return (
    <Card id="email-preferences" className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>Email preferences</CardTitle>
        <CardDescription>
          Choose which emails you receive. Workspace and project mutes apply to
          operational alerts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="notification-preferences-form"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <FieldGroup>
            {notificationCategories.map((category) => (
              <Field key={category.id} orientation="horizontal">
                <Checkbox
                  id={`notification-${category.id}`}
                  checked={value[category.id]}
                  disabled={busy || !query.data}
                  onCheckedChange={(checked) =>
                    setDraft({
                      preferences: {
                        ...value,
                        [category.id]: checked === true,
                      },
                      version: draft?.version ?? query.data!.version,
                    })
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor={`notification-${category.id}`}>
                    {category.label}
                  </FieldLabel>
                  <FieldDescription>{category.description}</FieldDescription>
                </FieldContent>
              </Field>
            ))}
            {extra.fields}
          </FieldGroup>
        </form>
        {query.isError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            Unable to load email preferences.{' '}
            <button className="underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button
          variant="ghost"
          disabled={busy || (!dirty && !extra.dirty)}
          onClick={() => {
            setDraft(null)
            extra.reset()
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form="notification-preferences-form"
          disabled={busy || (!dirty && !extra.dirty)}
        >
          {busy ? (
            <LoaderIcon data-icon="inline-start" className="animate-spin" />
          ) : null}
          Save
        </Button>
      </CardFooter>
    </Card>
  )
}

export function NotificationMute({ scope }: { scope: NotificationScope }) {
  const saving = useRef(false)
  const client = useQueryClient(),
    key = ['notification-mute', scope.kind, scope.id]
  const query = useQuery({
    queryKey: key,
    queryFn: () => getNotificationMute({ data: scope }),
  })
  const [draft, setDraft] = useState<boolean | null>(null),
    [pending, setPending] = useState(false)
  const value = draft ?? query.data?.muted ?? false
  async function save(muted: boolean) {
    if (saving.current || pending || !query.data) return
    setDraft(muted)
    saving.current = true
    setPending(true)
    try {
      client.setQueryData(
        key,
        await updateNotificationMute({ data: { scope, muted } }),
      )
      setDraft(null)
      toast.success('Notification preference saved.')
    } catch {
      setDraft(null)
      toast.error('Unable to save notification preference.')
    } finally {
      saving.current = false
      setPending(false)
    }
  }
  const id = `mute-${scope.kind}`
  return (
    <Card id="notifications" className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>My notifications</CardTitle>
        <CardDescription>This changes only your notifications.</CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <Switch
            id={id}
            checked={value}
            disabled={pending || !query.data}
            onCheckedChange={(checked) => void save(checked)}
          />
          {pending ? (
            <LoaderIcon
              role="status"
              aria-label="Saving notification preference"
              className="size-4 animate-spin"
            />
          ) : null}
          <FieldContent>
            <FieldLabel htmlFor={id}>
              Mute email notifications for this {scope.kind}
            </FieldLabel>
            <FieldDescription>
              {scope.kind === 'project'
                ? 'Stop emails about deployment failures, backup failures and domain issues for this project. A workspace mute also applies here.'
                : 'Stop emails about deployment failures, backup failures, server alerts and other issues across this workspace and its projects.'}
            </FieldDescription>
          </FieldContent>
        </Field>
        {query.isError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            Unable to load preferences.{' '}
            <button className="underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
