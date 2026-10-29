import { ApiScopeSelection } from './api-scope-selection'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { LoaderIcon, ArrowRightLeftIcon } from 'lucide-react'
import { Card, CardContent } from '#devpush/components/ui/card'
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '#devpush/components/ui/avatar'
import { Button } from '#devpush/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldContent,
  FieldDescription,
} from '#devpush/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#devpush/components/ui/select'
import { Checkbox } from '#devpush/components/ui/checkbox'
import { Skeleton } from '#devpush/components/ui/skeleton'
import { LogoMark } from '#devpush/components/logo-mark'
import { getPublicErrorMessage } from '#devpush/lib/public-error'
import { apiKeyPresets } from '#devpush/lib/api-key-schema'
import type { getMcpConsentAction } from '#devpush/server/mcp/functions'
import { completeMcpConsentAction } from '#devpush/server/mcp/functions'

type Consent = NonNullable<Awaited<ReturnType<typeof getMcpConsentAction>>>
function RequestingAppIcon({ src, name }: { src: string; name: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      <Avatar
        size="lg"
        className={loaded ? 'rounded-lg after:rounded-lg' : 'hidden'}
      >
        <AvatarImage
          src={src}
          alt={name}
          className="rounded-lg"
          referrerPolicy="no-referrer"
          onLoadingStatusChange={(status) => setLoaded(status === 'loaded')}
        />
      </Avatar>
      {loaded ? (
        <ArrowRightLeftIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </>
  )
}

function ConsentLayout({
  clientName,
  clientLogoUrl,
  children,
  pending = false,
}: {
  clientName?: string
  clientLogoUrl?: string | null
  children: ReactNode
  pending?: boolean
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div
        className="w-full max-w-md space-y-6"
        aria-busy={pending || undefined}
      >
        <header className="space-y-4 text-center">
          <div
            className="flex items-center justify-center gap-3"
            aria-label="App connection"
          >
            {!pending && clientLogoUrl ? (
              <RequestingAppIcon
                key={clientLogoUrl}
                src={clientLogoUrl}
                name={clientName ?? 'Requesting app'}
              />
            ) : null}
            <div
              className="flex size-10 items-center justify-center rounded-lg bg-orange-600 text-white"
              aria-label="devpush"
            >
              <LogoMark className="w-6" />
            </div>
          </div>
          <h1 className="flex min-h-14 items-center justify-center text-lg font-medium text-balance break-words">
            {clientName
              ? `${clientName} is requesting access to your devpush account`
              : 'Authorize access to devpush'}
          </h1>
        </header>
        {children}
      </div>
    </main>
  )
}

export function McpConsentPending() {
  return (
    <ConsentLayout pending>
      <Card>
        <CardContent>
          <FieldGroup>
            <div className="flex items-center gap-3 border-b pb-5">
              <Skeleton className="size-8 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-10 w-full" />
            <Field>
              <FieldLabel>Scope</FieldLabel>
              {['API access team', 'API access projects'].map((label) => (
                <Select key={label} disabled>
                  <SelectTrigger aria-label={label} className="w-full">
                    <Skeleton className="h-4 w-32" />
                  </SelectTrigger>
                </Select>
              ))}
            </Field>
            <Field>
              <FieldLabel>Access</FieldLabel>
              <Select disabled>
                <SelectTrigger
                  aria-label="Authorized access"
                  className="w-full"
                >
                  <Skeleton className="h-4 w-32" />
                </SelectTrigger>
              </Select>
              <Skeleton className="h-4 w-full" />
            </Field>
            <div className="flex gap-2" aria-hidden="true">
              <Skeleton className="size-4 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled>
          Cancel
        </Button>
        <Button disabled>Authorize</Button>
      </div>
    </ConsentLayout>
  )
}
export function McpConsent({ context }: { context: Consent }) {
  const [teamId, setTeamId] = useState(context.teams[0]?.id ?? '')
  const [projectId, setProjectId] = useState('all')
  const [preset, setPreset] = useState<'read' | 'deploy' | 'manage'>(
    context.requestedPermissions[0] ?? 'read',
  )
  const [includeLogs, setIncludeLogs] = useState(false)
  const [pendingAction, setPendingAction] = useState<boolean | null>(null)
  const busy = pendingAction !== null
  const [error, setError] = useState<string | null>(null)
  async function complete(accepted: boolean) {
    if (busy) return
    setPendingAction(accepted)
    setError(null)
    try {
      const result = await completeMcpConsentAction({
        data: {
          oauthQuery: context.oauthQuery,
          accepted,
          teamId: accepted ? teamId : undefined,
          projectIds: projectId === 'all' ? null : [projectId],
          preset,
          includeLogs,
        },
      })
      window.location.assign(result.redirectUrl)
    } catch (cause) {
      setError(
        getPublicErrorMessage(
          cause,
          'Unable to complete authorization. Please try again.',
        ),
      )
      setPendingAction(null)
    }
  }
  return (
    <ConsentLayout
      clientName={context.clientName}
      clientLogoUrl={context.clientLogoUrl}
    >
      <Card>
        <CardContent>
          <FieldGroup>
            <section
              aria-label="Signed-in account"
              className="flex items-center gap-3 border-b pb-5"
            >
              <Avatar>
                <AvatarImage
                  src={context.account.image ?? undefined}
                  alt={context.account.name}
                />
                <AvatarFallback>
                  {context.account.name.trim().charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {context.account.name}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {context.account.email}
                </p>
              </div>
            </section>
            <p className="text-sm">
              {context.clientName}
              {context.clientHost ? ` by ${context.clientHost}` : ''} is
              requesting the following access (expires in 30 days):
            </p>
            <ApiScopeSelection
              userId={context.userId}
              teamId={teamId}
              projectId={projectId}
              initialTeams={context.teams}
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
                onValueChange={(value) => setPreset(value as typeof preset)}
                disabled={busy}
              >
                <SelectTrigger
                  aria-label="Authorized access"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {context.requestedPermissions.map((permission) => (
                    <SelectItem key={permission} value={permission}>
                      {apiKeyPresets[permission].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {apiKeyPresets[preset].description}
              </FieldDescription>
            </Field>
            {context.allowLogs ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="consent-logs"
                  aria-describedby="consent-logs-description"
                  checked={includeLogs}
                  onCheckedChange={(value) => setIncludeLogs(value === true)}
                  disabled={busy}
                />
                <FieldContent>
                  <FieldLabel htmlFor="consent-logs">
                    Allow access to logs
                  </FieldLabel>
                  <FieldDescription id="consent-logs-description">
                    Deployment and application logs may contain sensitive
                    information.
                  </FieldDescription>
                </FieldContent>
              </Field>
            ) : null}
            <FieldError>{error}</FieldError>
          </FieldGroup>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void complete(false)}
        >
          {pendingAction === false ? (
            <LoaderIcon className="animate-spin" />
          ) : null}
          Cancel
        </Button>
        <Button disabled={busy || !teamId} onClick={() => void complete(true)}>
          {pendingAction === true ? (
            <LoaderIcon className="animate-spin" />
          ) : null}
          Authorize
        </Button>
      </div>
    </ConsentLayout>
  )
}
