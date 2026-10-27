import { mutationErrorOptions, afterMutation  } from '#devpush/lib/action-feedback'
import { toast } from 'sonner'
import { ApiScopeSelection } from './api-scope-selection'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EllipsisIcon, KeyRoundIcon, LoaderIcon, PlusIcon } from 'lucide-react'
import { SettingsSection } from '#devpush/components/settings-layout'
import { Button } from '#devpush/components/ui/button'
import { Input } from '#devpush/components/ui/input'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#devpush/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#devpush/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#devpush/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#devpush/components/ui/dropdown-menu'
import { Checkbox } from '#devpush/components/ui/checkbox'
import { Skeleton } from '#devpush/components/ui/skeleton'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import { CopyButton } from '#devpush/components/copy-button'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import {
  getApiKeySettingsAction,
  createApiKeyAction,
  rotateApiKeyAction,
  revokeApiKeyAction,
} from '#devpush/server/api/functions'
import {
  apiKeyPresets,
  apiKeyExpirationOptions,
} from '#devpush/lib/api-key-schema'

type KeySettings = Awaited<ReturnType<typeof getApiKeySettingsAction>>
type ApiKey = KeySettings['keys'][number]
type RevealedKey = Awaited<ReturnType<typeof createApiKeyAction>>

export function ApiKeysSettings({ userId }: { userId: string }) {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const queryKey = ['account-api-keys', userId, page]
  const query = useQuery({
    queryKey,
    queryFn: () => getApiKeySettingsAction({ data: { page } }),
    staleTime: 30_000,
  })
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<RevealedKey | null>(null)
  const [confirm, setConfirm] = useState<{
    key: ApiKey
    action: 'rotate' | 'revoke'
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const [projectId, setProjectId] = useState('all')
  const [preset, setPreset] = useState<keyof typeof apiKeyPresets>('read')
  const [includeLogs, setIncludeLogs] = useState(false)
  const [expiresInDays, setExpiresInDays] = useState('30')
  const teams = query.data?.teams ?? []
  const effectiveTeamId = teamId || teams[0]?.id || ''
  const scopes = apiKeyPresets[preset]
  const createButton = (
    <Button
      variant="outline"
      disabled={!query.data || teams.length === 0}
      onClick={() => {
        setError(null)
        setCreating(true)
      }}
    >
      <PlusIcon />
      Create API key
    </Button>
  )

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['account-api-keys', userId] })
  }
  async function create() {
    if (busy || !effectiveTeamId) return
    if (!name.trim()) {
      setError('Enter a name for this API key.')
      return
    }
    const expiration = apiKeyExpirationOptions.find(
      (option) => option.value === expiresInDays,
    )
    if (!expiration) {
      setError('Select an expiration for this API key.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await createApiKeyAction({
        data: {
          name: name.trim(),
          teamId: effectiveTeamId,
          projectIds: projectId === 'all' ? null : [projectId],
          preset,
          includeLogs,
          expiresInDays: expiration.days,
        },
      })
      setCreating(false)
      setName('')
      setRevealed(result)
      await afterMutation(
        refresh,
        'API key updated, but refreshing the list failed. Please reload.',
      )
    } catch (cause) {
      toast.error(
        getPublicErrorMessage(
          cause,
          'Unable to create API key. Please try again.',
        ),
        ...mutationErrorOptions(cause),
      )
    } finally {
      setBusy(false)
    }
  }
  async function change() {
    if (busy || !confirm) return
    setBusy(true)
    setError(null)
    try {
      if (confirm.action === 'rotate')
        setRevealed(await rotateApiKeyAction({ data: { id: confirm.key.id } }))
      else await revokeApiKeyAction({ data: { id: confirm.key.id } })
      setConfirm(null)
      await afterMutation(
        refresh,
        'API key updated, but refreshing the list failed. Please reload.',
      )
    } catch (cause) {
      toast.error(
        getPublicErrorMessage(
          cause,
          'Unable to update API key. Please try again.',
        ),
        ...mutationErrorOptions(cause),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsSection
        id="api-keys"
        title="API keys"
        description="Create keys for scripts, integrations and AI assistants using the API or MCP."
      >
        <div className="space-y-4">
          {!query.data || query.isError || query.data.keys.length > 0
            ? createButton
            : null}
          {query.isError ? (
            <div className="space-y-2">
              <FieldError>
                {getPublicErrorMessage(query.error, 'Unable to load API keys.')}
              </FieldError>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : query.data ? (
            query.data.keys.length ? (
              <ul className="overflow-hidden rounded-lg border">
                {query.data.keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex min-w-0 items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                  >
                    <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{key.name}</span>
                        <span className="text-xs capitalize text-muted-foreground">
                          {key.status}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {key.teamName} ·{' '}
                        {key.projectIds
                          ? `${key.projectIds.length} project${key.projectIds.length === 1 ? '' : 's'}`
                          : 'All projects'}{' '}
                        ·{' '}
                        {key.expiresAt
                          ? `Expires ${formatDate(key.expiresAt)}`
                          : 'Never expires'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last used{' '}
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'never'}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for API key ${key.name}`}
                        >
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={key.status !== 'active'}
                          onSelect={() => {
                            setError(null)
                            setConfirm({ key, action: 'rotate' })
                          }}
                        >
                          Rotate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={key.status === 'revoked'}
                          onSelect={() => {
                            setError(null)
                            setConfirm({ key, action: 'revoke' })
                          }}
                        >
                          Revoke
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyTitle>No API keys.</EmptyTitle>
                  <EmptyDescription>
                    Create an API key to let scripts and integrations access
                    devpush.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>{createButton}</EmptyContent>
              </Empty>
            )
          ) : (
            <ApiKeysPending />
          )}
          {query.data && query.data.pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {query.data.pagination.page} of{' '}
                {query.data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    page >= query.data.pagination.totalPages || query.isFetching
                  }
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SettingsSection>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) {
            setCreating(open)
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Choose what this key can access. It can never exceed your
              permissions.
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-api-key"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                <Input
                  id="api-key-name"
                  value={name}
                  maxLength={80}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Deploy automation"
                  required
                />
              </Field>
              <ApiScopeSelection
                userId={userId}
                teamId={effectiveTeamId}
                projectId={projectId}
                initialTeams={teams}
                disabled={busy}
                onChange={(team, project) => {
                  setTeamId(team)
                  setProjectId(project)
                }}
              />
              <Field>
                <FieldLabel>Access</FieldLabel>
                <Select
                  value={preset}
                  onValueChange={(value) =>
                    setPreset(value as keyof typeof apiKeyPresets)
                  }
                  disabled={busy}
                >
                  <SelectTrigger aria-label="API key access">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(apiKeyPresets).map(
                      ([value, definition]) => (
                        <SelectItem key={value} value={value}>
                          {definition.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {scopes.description}
                </p>
              </Field>
              <Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={includeLogs}
                    disabled={busy}
                    onCheckedChange={(value) => setIncludeLogs(value === true)}
                  />
                  Allow access to logs
                </label>
                <p className="text-xs text-muted-foreground">
                  Deployment and application logs may contain sensitive output.
                </p>
              </Field>
              <Field>
                <FieldLabel>Expiration</FieldLabel>
                <Select
                  value={expiresInDays}
                  onValueChange={setExpiresInDays}
                  disabled={busy}
                >
                  <SelectTrigger aria-label="API key expiration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {apiKeyExpirationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <FieldError>{error}</FieldError>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-api-key"
              disabled={busy || !effectiveTeamId}
            >
              {busy ? <LoaderIcon className="animate-spin" /> : null}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(revealed)}
        onOpenChange={(open) => {
          if (!open) setRevealed(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>
              This key is shown only once. Store it securely before closing this
              dialog.
            </DialogDescription>
          </DialogHeader>
          {revealed ? (
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <code className="min-w-0 flex-1 break-all text-xs">
                {revealed.secret}
              </code>
              <CopyButton value={revealed.secret} label="Copy API key" />
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!busy && !open) {
            setConfirm(null)
            setError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === 'rotate' ? 'Rotate' : 'Revoke'} API key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === 'rotate'
                ? 'The previous key stops working immediately. Copy the replacement and update the integrations that use it.'
                : 'Integrations using this API key will lose access immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldError>{error}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void change()
              }}
            >
              {busy ? <LoaderIcon className="animate-spin" /> : null}
              {confirm?.action === 'rotate' ? 'Rotate' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
export function ApiKeysPending() {
  return (
    <div className="space-y-2" role="status" aria-label="API keys loading">
      {[0, 1].map((row) => (
        <div
          key={row}
          className="flex h-16 items-center gap-3 rounded-lg border px-4"
        >
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="API key actions loading"
            disabled
          >
            <EllipsisIcon />
          </Button>
        </div>
      ))}
    </div>
  )
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
