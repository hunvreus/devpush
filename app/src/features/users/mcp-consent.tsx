import { ApiScopeSelection } from './api-scope-selection'
import { useState } from 'react'
import { ShieldCheckIcon, LoaderIcon } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { LogoMark } from '@/components/logo-mark'
import { getPublicErrorMessage } from '@/lib/public-error'
import { apiKeyPresets } from '@/lib/api-key-schema'
import type { getMcpConsentAction } from '@/server/mcp/functions'
import { completeMcpConsentAction } from '@/server/mcp/functions'

type Consent = NonNullable<Awaited<ReturnType<typeof getMcpConsentAction>>>
export function McpConsentPending() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md" aria-busy="true">
        <CardHeader>
          <LogoMark className="mb-3 size-8" />
          <CardTitle className="flex items-center gap-2">
            Connect <Skeleton className="h-5 w-28" />
          </CardTitle>
          <CardDescription>
            Authorize this app to use devpush on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
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
      <Card className="w-full max-w-md">
        <CardHeader>
          <LogoMark className="mb-3 size-8" />
          <CardTitle>Connect {context.clientName}</CardTitle>
          <CardDescription>
            Authorize this app to use devpush on your behalf.{' '}
            {context.redirectHost ? (
              <>
                You’ll return to{' '}
                <span className="font-medium text-foreground">
                  {context.redirectHost}
                </span>
                .
              </>
            ) : (
              <>Client ID: {context.clientId}.</>
            )}{' '}
            App names are provided by their developers and are not verified by
            devpush.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
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
              <p className="text-xs text-muted-foreground">
                {apiKeyPresets[preset].description}
              </p>
            </Field>
            {context.allowLogs ? (
              <Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={includeLogs}
                    onCheckedChange={(value) => setIncludeLogs(value === true)}
                    disabled={busy}
                  />
                  Allow access to logs
                </label>
                <p className="text-xs text-muted-foreground">
                  Deployment and application logs may contain sensitive output.
                </p>
              </Field>
            ) : null}
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheckIcon className="size-4 shrink-0" />
              Access follows your current permissions and expires in 30 days.
              You can revoke this connection in Account → Connected apps.
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
    </main>
  )
}
