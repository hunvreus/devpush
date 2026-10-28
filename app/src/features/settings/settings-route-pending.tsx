import { notificationCategories } from '#devpush/lib/notification-preferences'
import { Checkbox } from '#devpush/components/ui/checkbox'
import {
  accountSettingsNavigation,
  AccountSettingsPending,
} from '#devpush/features/plugins/contributions'
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { getRouteApi, useHydrated } from '@tanstack/react-router'
import { createDeferredModule } from '#devpush/lib/deferred-module'
import { ChevronDownIcon, PlusIcon, SearchIcon } from 'lucide-react'
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '#devpush/components/ui/field'
import { ApiKeysPending } from '#devpush/features/users/api-keys-settings'
import {
  ConnectedAppsDescription,
  ConnectedAppsPending,
} from '#devpush/features/users/connected-apps-settings'
import { ButtonGroup } from '#devpush/components/ui/button-group'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import { PendingTable } from '#devpush/components/pending-collection'
import type { SectionNavigationItem } from '#devpush/components/section-navigation'
import {
  SettingsSection,
  StandaloneSettingsLayout,
} from '#devpush/components/settings-layout'
import { Button } from '#devpush/components/ui/button'
import { Skeleton } from '#devpush/components/ui/skeleton'

export const adminSettingsModule = createDeferredModule(
  () => import('#devpush/features/admin/admin-settings'),
)
export const userSettingsModule = createDeferredModule(
  () => import('#devpush/features/users/user-settings'),
)

const adminItems: Array<SectionNavigationItem> = [
  { href: '#users', label: 'Users' },
  { href: '#allowlist', label: 'Allowlist' },
]

const userItems: Array<SectionNavigationItem> = [
  { href: '#general', label: 'General' },
  { href: '#email-preferences', label: 'Email preferences' },
  { href: '#authentication', label: 'Authentication' },
  { href: '#api-keys', label: 'API keys' },
  { href: '#connected-apps', label: 'Connected apps' },
  { href: '#teams', label: 'Teams' },
  ...accountSettingsNavigation,
  { href: '#danger', label: 'Danger', destructive: true },
]

type PendingSection = {
  description: ReactNode
  footer?: boolean
  kind: 'collection' | 'fields' | 'single-action'
  title: string
}

export function AdminSettingsPending() {
  const route = getRouteApi('/admin')
  const navigate = route.useNavigate()
  const routeContext = route.useLoaderData()
  const context = useHydrated() ? routeContext : undefined
  const module = adminSettingsModule.useModule(Boolean(context))
  if (context && module) {
    const AdminSettings = module.AdminSettings
    return (
      <AdminSettings
        currentUserId={context.userContext.user.id}
        overview={context.adminOverview}
        onSearchChange={(search) => {
          void navigate({
            search: (previous) => ({ ...previous, ...search }),
            replace: true,
            resetScroll: false,
          })
        }}
      />
    )
  }
  return (
    <SettingsPagePending
      ariaLabel="Loading admin settings"
      items={adminItems}
      sections={[
        {
          description: 'Manage the users registered on your platform.',
          kind: 'collection',
          title: 'Users',
        },
        {
          description:
            'Control who can sign up and sign in. An empty allowlist means no restrictions.',
          kind: 'collection',
          title: 'Allowlist',
        },
      ]}
      title="Admin"
    />
  )
}

export function UserSettingsPending() {
  const route = getRouteApi('/settings')
  const routeContext = route.useLoaderData()
  const context = useHydrated() ? routeContext : undefined
  const module = userSettingsModule.useModule(Boolean(context))
  if (context && module) return <module.UserSettings context={context} />
  return (
    <SettingsPagePending
      ariaLabel="Loading account settings"
      items={userItems}
      sections={[
        {
          description: 'General settings for your account.',
          footer: true,
          kind: 'fields',
          title: 'General',
        },
        {
          title: 'Email preferences',
          description:
            'Choose which emails you receive. Workspace and project mutes apply to operational alerts.',
          footer: true,
          kind: 'fields',
        },
        {
          description: 'Manage the ways you can sign in to your account.',
          kind: 'collection',
          title: 'Authentication',
        },
        {
          description:
            'Create keys for scripts, integrations and AI assistants using the API or MCP.',
          kind: 'collection',
          title: 'API keys',
        },
        {
          description: <ConnectedAppsDescription />,
          kind: 'collection',
          title: 'Connected apps',
        },
        {
          description: 'Manage the teams you are a member of.',
          kind: 'collection',
          title: 'Teams',
        },
        {
          description:
            'Permanently delete your account. Teams where you are the only member are deleted too.',
          kind: 'single-action',
          title: 'Danger',
        },
      ]}
      title="Account"
    />
  )
}

function SettingsPagePending({
  ariaLabel,
  items,
  sections,
  title,
}: {
  ariaLabel: string
  items: Array<SectionNavigationItem>
  sections: Array<PendingSection>
  title: string
}) {
  return (
    <StandaloneSettingsLayout
      ariaLabel={ariaLabel}
      busy
      navigation={items}
      title={title}
    >
      {sections.map((section) => (
        <Fragment key={section.title}>
          {title === 'Account' && section.title === 'Danger' ? (
            <AccountSettingsPending />
          ) : null}
          <PendingSettingsCard section={section} />
        </Fragment>
      ))}
    </StandaloneSettingsLayout>
  )
}

function PendingSettingsCard({ section }: { section: PendingSection }) {
  return (
    <SettingsSection
      id={section.title.toLowerCase().replaceAll(' ', '-')}
      title={section.title}
      description={section.description}
      footer={
        section.footer ? (
          <>
            <Button variant="ghost" disabled>
              Cancel
            </Button>
            <Button disabled>Save</Button>
          </>
        ) : undefined
      }
    >
      <PendingCardContent kind={section.kind} title={section.title} />
    </SettingsSection>
  )
}

function PendingCardContent({
  kind,
  title,
}: {
  kind: PendingSection['kind']
  title: string
}) {
  if (kind === 'collection') {
    if (title === 'API keys')
      return (
        <div className="space-y-4">
          <Button variant="outline" disabled>
            <PlusIcon />
            Create API key
          </Button>
          <ApiKeysPending />
        </div>
      )
    if (title === 'Connected apps') return <ConnectedAppsPending />
    if (title === 'Authentication')
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading sign-in methods…
        </p>
      )
    if (title === 'Teams')
      return (
        <PendingTable
          label="Teams loading"
          avatar
          columns={[
            { title: 'Name' },
            { title: 'Role' },
            { title: '', className: 'w-10' },
          ]}
        />
      )
    if (title === 'Users')
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <InputGroup className="mr-auto max-w-72">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search users"
                placeholder="Search users..."
                disabled
              />
            </InputGroup>
            <Button variant="outline" disabled>
              Search
            </Button>
          </div>
          <PendingTable
            label="Users loading"
            avatar
            columns={[
              { title: 'User' },
              { title: 'Email' },
              { title: 'Created' },
              { title: 'Status' },
              { title: '', className: 'w-28' },
            ]}
          />
        </div>
      )
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <InputGroup className="max-w-72">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search allowlist"
                placeholder="Search rules..."
                disabled
              />
            </InputGroup>
            <Button variant="outline" disabled>
              Search
            </Button>
          </div>
          <ButtonGroup>
            <Button variant="outline" disabled>
              <PlusIcon data-icon="inline-start" />
              Add rule
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled
              aria-label="More allowlist actions"
            >
              <ChevronDownIcon />
            </Button>
          </ButtonGroup>
        </div>
        <PendingTable
          label="Allowlist loading"
          columns={[
            { title: 'Type' },
            { title: 'Value' },
            { title: 'Added' },
            { title: '', className: 'w-16' },
          ]}
        />
      </div>
    )
  }

  if (kind === 'single-action') {
    return (
      <Button variant="destructive" disabled>
        Delete account
      </Button>
    )
  }

  if (title === 'Email preferences')
    return (
      <FieldGroup>
        {notificationCategories.map((category) => (
          <Field key={category.id} orientation="horizontal">
            <Checkbox checked disabled />
            <FieldContent>
              <FieldLabel>{category.label}</FieldLabel>
              <FieldDescription>{category.description}</FieldDescription>
            </FieldContent>
          </Field>
        ))}
      </FieldGroup>
    )

  if (title === 'General') {
    return (
      <FieldGroup>
        <Field>
          <FieldLabel>Picture</FieldLabel>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            disabled
            aria-label="Upload profile picture"
          >
            <Skeleton className="size-9 rounded-full" />
          </Button>
        </Field>
        <PendingField label="Name" />
        <PendingField label="Username" />
        <PendingField
          label="Email"
          description="Verification is required before the new email is used for sign in."
        />
      </FieldGroup>
    )
  }

  return (
    <PendingField
      label="Email"
      description="Verification is required before the new email is used for sign in."
    />
  )
}

function PendingField({
  description,
  label,
}: {
  description?: string
  label: string
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Skeleton className="h-8 w-full" />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}
