import { ArrowRightIcon, LoaderIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { EnvironmentDot } from '@/features/projects/environment-dot'
import type {
  ProjectDomain,
  ProjectEnvironmentConfig,
  ProjectRoute,
} from '@/server/projects/service'
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
  routes,
  services,
  environments,
  suggestedRoute,
  onChange,
}: {
  routes: Array<ProjectRouteDefinition>
  services: Array<string>
  environments: Array<ProjectEnvironmentConfig>
  suggestedRoute: ProjectRoute | null
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
      suggestedRoute ?? {
        path: '/',
        service: services.at(0) ?? 'web',
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
          <datalist id="route-services">
            {services.map((service) => (
              <option value={service} key={service} />
            ))}
          </datalist>
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
                className="grid w-full grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.1fr)_1rem_minmax(0,1.1fr)_minmax(5.5rem,0.4fr)_3.5rem_2.5rem] items-center gap-x-2 border-b py-2"
                key={index}
              >
                <Field className="gap-0">
                  <Select
                    value={route.environmentId ?? '__all__'}
                    onValueChange={(value) =>
                      updateRoute(index, {
                        environmentId: value === '__all__' ? undefined : value,
                      })
                    }
                  >
                    <SelectTrigger aria-label="Route scope" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All environments</SelectItem>
                      {environments.map((environment) => (
                        <SelectItem key={environment.id} value={environment.id}>
                          <EnvironmentOptionLabel
                            color={environment.color}
                            label={environment.name}
                          />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="gap-0">
                  <Input
                    aria-label="Route path"
                    value={route.path}
                    onChange={(event) =>
                      updateRoute(index, { path: event.target.value })
                    }
                    placeholder="/"
                  />
                </Field>
                <ArrowRightIcon className="mx-auto size-4 text-muted-foreground" />
                <Field className="gap-0">
                  <Input
                    aria-label="Route service"
                    list="route-services"
                    value={route.service}
                    onChange={(event) =>
                      updateRoute(index, { service: event.target.value })
                    }
                    placeholder="web"
                  />
                </Field>
                <Field className="gap-0">
                  <Input
                    aria-label="Route port"
                    type="number"
                    min={1}
                    max={65535}
                    value={route.port}
                    onChange={(event) =>
                      updateRoute(index, { port: Number(event.target.value) })
                    }
                    placeholder="3000"
                  />
                </Field>
                <div className="flex h-full items-center gap-2">
                  <Switch
                    aria-label="Strip route prefix"
                    checked={route.stripPrefix}
                    onCheckedChange={(checked) =>
                      updateRoute(index, { stripPrefix: checked })
                    }
                  />
                </div>
                <div className="flex justify-end">
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
  domains,
  environments,
  routes,
  onChange,
  onVerify,
  verifyingDomainId,
  verificationDisabled,
}: {
  domains: Array<ProjectDomainAlias>
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
            <div className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_5.5rem_2.5rem] gap-x-2 border-b pb-2 text-sm font-medium">
              <div>Host</div>
              <div>Environment</div>
              <div>Base route</div>
              <div>HTTPS</div>
              <div>Status</div>
              <div />
            </div>
            {domains.map((domain) => (
              <div
                className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_3.5rem_5.5rem_2.5rem] items-center gap-x-2 border-b py-2"
                key={domain.id}
              >
                <Field className="gap-0">
                  <Input
                    aria-label="Domain host"
                    value={domain.host}
                    onChange={(event) =>
                      updateDomain(domain.id, { host: event.target.value })
                    }
                    placeholder="myapp.com"
                  />
                </Field>
                <Field className="gap-0">
                  <Select
                    value={domain.environment}
                    onValueChange={(value) =>
                      updateDomain(domain.id, { environment: value })
                    }
                  >
                    <SelectTrigger
                      aria-label="Domain environment"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {environments.map((environment) => (
                        <SelectItem key={environment.id} value={environment.id}>
                          <EnvironmentOptionLabel
                            color={environment.color}
                            label={environment.name}
                          />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="gap-0">
                  <Select
                    value={domain.baseRoute || 'all'}
                    onValueChange={(value) =>
                      updateDomain(domain.id, {
                        baseRoute: value === 'all' ? '' : value,
                      })
                    }
                  >
                    <SelectTrigger
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
                </Field>
                <div className="flex h-full items-center justify-center">
                  <Switch
                    aria-label="HTTPS"
                    checked={domain.https}
                    onCheckedChange={(checked) =>
                      updateDomain(domain.id, { https: checked })
                    }
                  />
                </div>
                <div className="flex justify-start">
                  {domain.status === 'active' ? (
                    <Badge variant="secondary">Verified</Badge>
                  ) : (
                    <Button
                      variant="outline"
                      type="button"
                      disabled={
                        verificationDisabled ||
                        !domain.status ||
                        verifyingDomainId !== null
                      }
                      title={domain.message ?? undefined}
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
                  )}
                </div>
                <div className="flex justify-end">
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
              </div>
            ))}
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
