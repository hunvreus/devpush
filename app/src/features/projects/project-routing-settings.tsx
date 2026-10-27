import type { ServerSummary } from '#devpush/server/teams/types'
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from '#devpush/components/ui/alert'
import { ComposeServiceInput } from './compose-service-input'
import type { ReactNode } from 'react'
import type { FormErrors } from '#devpush/lib/form-errors'
import {
  ArrowRightIcon,
  LoaderIcon,
  LockIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'

import { Button } from '#devpush/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import { Field, FieldError } from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from '#devpush/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import { Switch } from '#devpush/components/ui/switch'
import { EnvironmentDot } from '#devpush/features/projects/environment-dot'
import type {
  ProjectDomain,
  ProjectEnvironmentConfig,
  ProjectRoute,
} from '#devpush/server/projects/types'
import { ProjectSettingsActionTooltip as IconActionTooltip } from './project-settings-section'
import { getEffectiveProjectRoutes as getEffectiveRouteDefinitions } from './project-settings-utils'

export type ProjectRouteDefinition = ProjectRoute

export type ProjectDomainAlias = {
  id: string
  host: string
  environment: string
  baseRoute: string
  https: boolean
  status?: ProjectDomain['status']
  message?: string | null
}

export function RouteSettingsTable({
  services = [],
  routes,
  environments,
  onChange,
  errors = {},
}: {
  services?: string[]
  routes: Array<ProjectRouteDefinition>
  errors?: FormErrors
  environments: Array<ProjectEnvironmentConfig>
  onChange: (routes: Array<ProjectRouteDefinition>) => void
}) {
  function updateRoute(index: number, next: Partial<ProjectRouteDefinition>) {
    onChange(
      routes.map((route, routeIndex) =>
        routeIndex === index ? { ...route, ...next } : route,
      ),
    )
  }

  function addRoute() {
    onChange([
      ...routes,
      {
        path: '/',
        service: '',
        port: 80,
        stripPrefix: false,
      },
    ])
  }

  function removeRoute(index: number) {
    onChange(routes.filter((_, routeIndex) => routeIndex !== index))
  }

  return (
    <div className="space-y-4">
      {routes.length > 0 ? (
        <>
          <div>
            <div className="grid w-full grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.1fr)_1rem_minmax(0,1.1fr)_minmax(5.5rem,0.4fr)_3.5rem_2.5rem] gap-x-2 border-b pb-2 text-sm font-medium">
              <div>Scope</div>
              <div>Path</div>
              <div />
              <div>Service</div>
              <div>Port</div>
              <div>Strip</div>
              <div />
            </div>
            {routes.map((route, index) => (
              <div
                className="grid w-full grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.1fr)_1rem_minmax(0,1.1fr)_minmax(5.5rem,0.4fr)_3.5rem_2.5rem] items-start gap-x-2 border-b py-2"
                key={index}
              >
                <RoutingField
                  name={`routes.${index}.environmentId`}
                  errors={errors}
                >
                  <Select
                    value={route.environmentId ?? '__all__'}
                    onValueChange={(value) =>
                      updateRoute(index, {
                        environmentId: value === '__all__' ? undefined : value,
                      })
                    }
                  >
                    <SelectTrigger
                      {...routingFieldProps(
                        `routes.${index}.environmentId`,
                        errors,
                      )}
                      aria-label="Route scope"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All environments</SelectItem>
                      {environments.map((optionEnvironment) => (
                        <SelectItem
                          key={optionEnvironment.id}
                          value={optionEnvironment.id}
                        >
                          <EnvironmentOptionLabel
                            color={optionEnvironment.color}
                            label={optionEnvironment.name}
                          />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </RoutingField>
                <RoutingField name={`routes.${index}.path`} errors={errors}>
                  <Input
                    {...routingFieldProps(`routes.${index}.path`, errors)}
                    aria-label="Route path"
                    required
                    value={route.path}
                    onChange={(event) =>
                      updateRoute(index, { path: event.target.value })
                    }
                    placeholder="/"
                  />
                </RoutingField>
                <ArrowRightIcon className="mx-auto mt-2 size-4 shrink-0 text-muted-foreground" />
                <RoutingField name={`routes.${index}.service`} errors={errors}>
                  <ComposeServiceInput
                    {...routingFieldProps(`routes.${index}.service`, errors)}
                    services={services}
                    aria-label="Route service"
                    required
                    value={route.service}
                    onValueChange={(service) => updateRoute(index, { service })}
                    placeholder="web"
                  />
                </RoutingField>
                <RoutingField name={`routes.${index}.port`} errors={errors}>
                  <Input
                    {...routingFieldProps(`routes.${index}.port`, errors)}
                    aria-label="Route port"
                    required
                    step={1}
                    type="number"
                    min={1}
                    max={65535}
                    value={route.port}
                    onChange={(event) =>
                      updateRoute(index, { port: Number(event.target.value) })
                    }
                    placeholder="3000"
                  />
                </RoutingField>
                <div className="flex h-8 items-center gap-2">
                  <Switch
                    aria-label="Strip route prefix"
                    checked={route.stripPrefix}
                    onCheckedChange={(checked) =>
                      updateRoute(index, { stripPrefix: checked })
                    }
                  />
                </div>
                <div className="-mr-2 flex justify-end">
                  <IconActionTooltip label="Remove route">
                    <Button
                      variant="destructive"
                      size="icon"
                      type="button"
                      aria-label="Remove route"
                      onClick={() => removeRoute(index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </IconActionTooltip>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" type="button" onClick={addRoute}>
            <PlusIcon data-icon="inline-start" />
            Add route
          </Button>
        </>
      ) : (
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyTitle>No routes configured.</EmptyTitle>
            <EmptyDescription>
              Services remain private until you add a public route.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" type="button" onClick={addRoute}>
              <PlusIcon data-icon="inline-start" />
              Add route
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}

export function ManagedIngressWarnings({
  warnings,
}: {
  warnings: Array<string>
}) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        {warnings.length} Compose{' '}
        {warnings.length === 1 ? 'adjustment' : 'adjustments'}
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  )
}

export function EnvironmentOptionLabel({
  color,
  label,
}: {
  color?: string
  label: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-x-2">
      {color ? <EnvironmentDot color={color} /> : null}
      <span className="truncate">{label}</span>
    </span>
  )
}

export function DomainSettingsTable({
  servers = [],
  domains,
  environments,
  routes,
  onChange,
  onVerify,
  verifyingDomainId,
  verificationDisabled,
  errors = {},
}: {
  servers?: Pick<
    ServerSummary,
    'id' | 'name' | 'publicAddress' | 'publicIpv4' | 'publicIpv6'
  >[]
  domains: Array<ProjectDomainAlias>
  errors?: FormErrors
  environments: Array<ProjectEnvironmentConfig>
  routes: Array<ProjectRouteDefinition>
  onChange: (domains: Array<ProjectDomainAlias>) => void
  onVerify: (domainId: string) => Promise<void>
  verifyingDomainId: string | null
  verificationDisabled: boolean
}) {
  function updateDomain(id: string, next: Partial<ProjectDomainAlias>) {
    onChange(
      domains.map((domain) =>
        domain.id === id ? { ...domain, ...next } : domain,
      ),
    )
  }

  function addDomain() {
    onChange([
      ...domains,
      {
        id: crypto.randomUUID(),
        host: '',
        environment: environments.at(0)?.id ?? 'production',
        baseRoute: '',
        https: true,
        status: undefined,
        message: null,
      },
    ])
  }

  function removeDomain(id: string) {
    onChange(domains.filter((domain) => domain.id !== id))
  }

  return (
    <div className="space-y-4">
      {domains.length > 0 ? (
        <>
          <div>
            <div className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_2.5rem] gap-x-2 border-b pb-2 text-sm font-medium">
              <div>Host</div>
              <div>Environment</div>
              <div>Base route</div>
              <div>HTTPS</div>
              <div />
            </div>
            {domains.map((domain, index) => {
              const environment = environments.find(
                (item) => item.id === domain.environment,
              )
              const server = servers.find(
                (item) => item.id === environment?.effectiveServerId,
              )
              const address = server?.publicAddress
              const addresses = [
                ...new Set(
                  [server?.publicIpv4, server?.publicIpv6, address].filter(
                    (value): value is string => Boolean(value),
                  ),
                ),
              ]

              const rowErrors: FormErrors = { ...errors }
              const hostError =
                errors[`verification.${domain.id}`] ??
                (domain.status === 'failed' ? domain.message : null)

              return (
                <div
                  className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_2.5rem] items-start gap-x-2 border-b py-2"
                  key={domain.id}
                >
                  <RoutingField
                    name={`domains.${index}.host`}
                    errors={rowErrors}
                  >
                    <InputGroup
                      className={
                        domain.status !== undefined ? 'bg-accent/50' : undefined
                      }
                    >
                      <InputGroupInput
                        {...routingFieldProps(
                          `domains.${index}.host`,
                          rowErrors,
                        )}
                        aria-label="Domain host"
                        required
                        maxLength={253}
                        value={domain.host}
                        readOnly={domain.status !== undefined}
                        onChange={(event) => {
                          if (domain.status !== undefined) return
                          updateDomain(domain.id, {
                            host: event.target.value,
                            status: undefined,
                            message: null,
                          })
                        }}
                        placeholder="myapp.com"
                      />
                      {domain.status !== undefined ? (
                        <InputGroupAddon align="inline-end">
                          <IconActionTooltip label="Add and verify a new host before removing this one.">
                            <span>
                              <LockIcon className="size-4 shrink-0" />
                            </span>
                          </IconActionTooltip>
                        </InputGroupAddon>
                      ) : null}
                    </InputGroup>
                  </RoutingField>
                  <RoutingField
                    name={`domains.${index}.environmentId`}
                    errors={rowErrors}
                  >
                    <Select
                      value={domain.environment}
                      onValueChange={(value) =>
                        updateDomain(domain.id, { environment: value })
                      }
                    >
                      <SelectTrigger
                        {...routingFieldProps(
                          `domains.${index}.environmentId`,
                          errors,
                        )}
                        aria-label="Domain environment"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {environments.map((optionEnvironment) => (
                          <SelectItem
                            key={optionEnvironment.id}
                            value={optionEnvironment.id}
                          >
                            <EnvironmentOptionLabel
                              color={optionEnvironment.color}
                              label={optionEnvironment.name}
                            />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </RoutingField>
                  <RoutingField
                    name={`domains.${index}.basePath`}
                    errors={rowErrors}
                  >
                    <Select
                      value={domain.baseRoute || 'all'}
                      onValueChange={(value) =>
                        updateDomain(domain.id, {
                          baseRoute: value === 'all' ? '' : value,
                        })
                      }
                    >
                      <SelectTrigger
                        {...routingFieldProps(
                          `domains.${index}.basePath`,
                          errors,
                        )}
                        aria-label="Domain base route"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All routes</SelectItem>
                        {getEffectiveRouteDefinitions(
                          routes,
                          domain.environment,
                        ).map((route) => (
                          <SelectItem value={route.path} key={route.path}>
                            {route.path}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </RoutingField>
                  <div className="flex h-8 items-center justify-center">
                    <Switch
                      aria-label="HTTPS"
                      checked={domain.https}
                      onCheckedChange={(checked) =>
                        updateDomain(domain.id, { https: checked })
                      }
                    />
                  </div>
                  <div className="-mr-2 flex justify-end">
                    <IconActionTooltip label="Remove domain">
                      <Button
                        variant="destructive"
                        size="icon"
                        type="button"
                        aria-label="Remove domain"
                        onClick={() => removeDomain(domain.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </IconActionTooltip>
                  </div>
                  {hostError ||
                  domain.status === 'pending' ||
                  domain.status === 'failed' ||
                  domain.status === 'disabled' ? (
                    <Alert variant="warning" className="col-span-full mt-2">
                      <TriangleAlertIcon />
                      <AlertTitle>
                        {domain.status === 'disabled'
                          ? `${domain.host} is disabled.`
                          : hostError || domain.status === 'failed'
                            ? `${domain.host} is not configured correctly.`
                            : `${domain.host} is not yet verified.`}
                      </AlertTitle>
                      <AlertDescription className="[&_p:not(:last-child)]:mb-0">
                        <div className="flex flex-col gap-4">
                          {domain.status === 'disabled' ? (
                            <p>
                              Select an active environment and save the domain
                              before verifying.
                            </p>
                          ) : address ? (
                            <>
                              <p>
                                Add one or both of the following DNS records at
                                your domain provider pointing to {server.name},
                                the server assigned to {environment?.name}.
                                Disable CDN/proxy mode while verifying this
                                domain. After changing the records, click Verify
                                to check status.
                              </p>
                              <div className="scrollbar overflow-x-auto rounded-md border">
                                <table className="w-full text-left text-sm">
                                  <thead className="text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2 font-medium first:pl-4 last:pr-4">
                                        Type
                                      </th>
                                      <th className="px-3 py-2 font-medium first:pl-4 last:pr-4">
                                        Name
                                      </th>
                                      <th className="px-3 py-2 font-medium first:pl-4 last:pr-4">
                                        Value
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="font-mono text-xs">
                                    {addresses.map((dnsAddress) => (
                                      <tr key={dnsAddress} className="border-t">
                                        <td className="px-3 py-2 first:pl-4 last:pr-4">
                                          {dnsAddress.includes(':')
                                            ? 'AAAA'
                                            : 'A'}
                                        </td>
                                        <td className="px-3 py-2 first:pl-4 last:pr-4">
                                          {domain.host}
                                        </td>
                                        <td className="px-3 py-2 first:pl-4 last:pr-4">
                                          {dnsAddress}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          ) : (
                            <p>
                              {server
                                ? 'The assigned server has no public IP address. Configure its public address before verifying.'
                                : 'Assign a server to this environment before configuring its DNS records.'}
                            </p>
                          )}
                          {hostError ? (
                            <p className="text-muted-foreground">
                              Error details: {hostError}
                            </p>
                          ) : null}
                        </div>
                      </AlertDescription>
                      <AlertAction>
                        <Button
                          variant="default"
                          size="xs"
                          type="button"
                          disabled={
                            verificationDisabled ||
                            !domain.status ||
                            verifyingDomainId !== null
                          }
                          aria-label={`Verify ${domain.host || 'domain'}`}
                          onClick={() => void onVerify(domain.id)}
                        >
                          {verifyingDomainId === domain.id ? (
                            <LoaderIcon
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : null}
                          Verify
                        </Button>
                      </AlertAction>
                    </Alert>
                  ) : null}
                </div>
              )
            })}
          </div>
          <Button variant="outline" type="button" onClick={addDomain}>
            <PlusIcon data-icon="inline-start" />
            Add domain
          </Button>
        </>
      ) : (
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyTitle>No custom domains.</EmptyTitle>
            <EmptyDescription>
              Add a domain and map it to an environment route.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" type="button" onClick={addDomain}>
              <PlusIcon data-icon="inline-start" />
              Add domain
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}

function routingFieldProps(name: string, errors: FormErrors) {
  return {
    id: name,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  }
}

function RoutingField({
  name,
  errors,
  children,
}: {
  name: string
  errors: FormErrors
  children: ReactNode
}) {
  return (
    <Field className="gap-1" data-invalid={Boolean(errors[name])}>
      {children}
      <FieldError id={`${name}-error`}>{errors[name]}</FieldError>
    </Field>
  )
}
