import { ArrowUpRightIcon, ChevronsUpDownIcon, Link2Icon } from 'lucide-react'
import { Button } from '#devpush/components/ui/button'
import { ButtonGroup } from '#devpush/components/ui/button-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#devpush/components/ui/popover'
import { routeUrl } from '#devpush/lib/urls'
import type { PluginContext } from '#devpush/server/projects/types'

export function DeploymentVisitLinks({
  canVisit,
  visitUrl,
  aliases,
}: {
  canVisit: boolean
  visitUrl: string | null
  aliases: PluginContext['visitAliases']
}) {
  const links = aliases.filter(
    (alias) => alias.type === 'branch' || alias.type === 'environment',
  )
  return (
    <ButtonGroup aria-label="Visit deployment">
      {canVisit && visitUrl ? (
        <Button asChild>
          <a href={visitUrl} target="_blank" rel="noreferrer">
            <Link2Icon data-icon="inline-start" />
            Visit
          </a>
        </Button>
      ) : (
        <Button disabled>
          <Link2Icon data-icon="inline-start" />
          Visit
        </Button>
      )}
      {canVisit && visitUrl && links.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" className="w-6" aria-label="Deployment links">
              <ChevronsUpDownIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
            <ul className="space-y-2">
              <VisitLink
                label="Deployment URL"
                url={visitUrl}
                hostname={new URL(visitUrl).host}
              />
              {links.map((alias) => (
                <VisitLink
                  key={`${alias.type}:${alias.hostname}`}
                  label={
                    alias.type === 'branch' ? 'Branch URL' : 'Environment URL'
                  }
                  url={routeUrl({ host: alias.hostname, https: alias.https })}
                  hostname={alias.hostname}
                />
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </ButtonGroup>
  )
}

function VisitLink({
  label,
  url,
  hostname,
}: {
  label: string
  url: string
  hostname: string
}) {
  return (
    <li className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <a
        href={url}
        title={hostname}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-center gap-2 hover:underline"
      >
        <span className="truncate">{hostname}</span>
        <ArrowUpRightIcon className="size-3 shrink-0 opacity-50" />
      </a>
    </li>
  )
}
