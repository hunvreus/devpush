import { ApiScopeSelection } from './api-scope-selection'
import { useState } from 'react'
import { ShieldCheckIcon, LoaderIcon, AppWindowIcon } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#devpush/components/ui/card'
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
function ConsentLogo() {
  return (
    <div
      className="mx-auto mb-6 flex size-8 items-center justify-center rounded-lg bg-orange-600 text-white"
      aria-label="devpush"
    >
      <LogoMark className="size-5 shrink-0" />
    </div>
  )
}

export function McpConsentPending() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md" aria-busy="true">
        <ConsentLogo />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Connect to devpush
            </CardTitle>
            <CardDescription>
              Choose what this app can access on your behalf.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <AppWindowIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <Field>
                <FieldLabel>Scope</FieldLabel>
                {['API access team', 'API access project'].map((label) => (
                  <Select key={label} disabled>
                    <SelectTrigger aria-label={label}>
                      <Skeleton className="h-4 w-32" />
                    </SelectTrigger>
                  </Select>
                ))}
              </Field>
              <Field>
                <FieldLabel>Access</FieldLabel>
                <Select disabled>
                  <SelectTrigger aria-label="Authorized access">
                    <Skeleton className="h-4 w-32" />
                  </SelectTrigger>
                </Select>
                <Skeleton className="h-3 w-full" />
              </Field>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-4 shrink-0" />
                Access follows your current permissions and expires in 30 days.
                You can revoke this connection in Account → Connected apps.
              </p>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="ghost" disabled>
              Deny
            </Button>
            <Button disabled>Authorize</Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
export function McpConsent({ context }: { context: Consent }) {
  const [teamId, setTeamId] = useState(context.teams[0]?.id ?? '')
  const [projectId, setProjectId] = useState('all')
  const [preset, setPreset] = useState<'read' | 'deploy' | 'manage'>(
    context.requestedPermissions[0] ?? 'read',
  )
  const [includeLogs, setIncludeLogs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function complete(accepted: boolean) {
    if (busy) return
    setBusy(true)
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
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md">
        <ConsentLogo />
        <Card>
          <CardHeader>
            <CardTitle>Connect to devpush</CardTitle>
            <CardDescription>
              Choose what this app can access on your behalf.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <AppWindowIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">
                    {context.clientName}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {context.redirectHost
                      ? `Returns to ${context.redirectHost}`
                      : `Client ID: ${context.clientId}`}
                  </p>
                </div>
              </div>
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
                  <SelectTrigger aria-label="Authorized access">
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
                      Include deployment and application logs, which may contain
                      sensitive information.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              ) : null}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-4 shrink-0" />
                Access follows your current permissions and expires in 30 days.
                You can revoke this connection in Account → Connected apps.
              </p>
              <p className="text-xs text-muted-foreground">
                App names are supplied by their developers and aren’t verified
                by devpush.
              </p>
              <FieldError>{error}</FieldError>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void complete(false)}
            >
              Deny
            </Button>
            <Button
              disabled={busy || !teamId}
              onClick={() => void complete(true)}
            >
              {busy ? <LoaderIcon className="animate-spin" /> : null}Authorize
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
