import { getRouteApi, useHydrated } from '@tanstack/react-router'
import { AdminSettings } from '@/features/admin/admin-settings'
import { UserSettings } from '@/features/users/user-settings'
import { ChevronDownIcon, PlusIcon, SearchIcon, UploadIcon } from 'lucide-react'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '@/components/ui/field'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { PendingTable } from '@/components/pending-collection'
import type { SectionNavigationItem } from '@/components/section-navigation'
import {
  SettingsSection,
  StandaloneSettingsLayout,
} from '@/components/settings-layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const adminItems: Array<SectionNavigationItem> = [
  { href: '#installation', label: 'Installation' },
  { href: '#users', label: 'Users' },
  { href: '#allowlist', label: 'Allowlist' },
]

const userItems: Array<SectionNavigationItem> = [
  { href: '#general', label: 'General' },
  { href: '#email', label: 'Email' },
  { href: '#authentication', label: 'Authentication' },
  { href: '#teams', label: 'Teams' },
  { href: '#danger', label: 'Danger', destructive: true },
]

type PendingSection = {
  description: string
  footer?: boolean
  kind: 'collection' | 'fields' | 'installation' | 'single-action'
  title: string
}

export function AdminSettingsPending() {
  const route = getRouteApi('/admin')
  const routeContext = route.useLoaderData()
  const context = useHydrated() ? routeContext : undefined
  if (context)
    return (
      <AdminSettings
        currentUserId={context.userContext.user.id}
        overview={context.adminOverview}
      />
    )
  return (
    <SettingsPagePending
      ariaLabel="Loading admin settings"
      items={adminItems}
      sections={[
        {
          description:
            'Information about this installation and available updates.',
          kind: 'installation',
          title: 'Installation',
        },
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
      title="Admin settings"
    />
  )
}

export function UserSettingsPending() {
  const route = getRouteApi('/settings')
  const routeContext = route.useLoaderData()
  const context = useHydrated() ? routeContext : undefined
  if (context) return <UserSettings context={context} />
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
          description:
            'The email address used for authentication and notifications.',
          footer: true,
          kind: 'fields',
          title: 'Email',
        },
        {
          description: 'Manage the ways you can sign in to your account.',
          kind: 'collection',
          title: 'Authentication',
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
      title="Account settings"
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
        <PendingSettingsCard key={section.title} section={section} />
      ))}
    </StandaloneSettingsLayout>
  )
}

function PendingSettingsCard({ section }: { section: PendingSection }) {
  return (
    <SettingsSection
      id={section.title.toLowerCase()}
      title={section.title}
      description={section.description}
      contentClassName={
        section.kind === 'installation' ? 'min-h-40' : undefined
      }
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
          <InputGroup className="mr-auto max-w-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search..." disabled />
          </InputGroup>
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
        <div className="flex justify-end">
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

  if (kind === 'installation') {
    return (
      <div className="grid gap-6 sm:grid-cols-3">
        {['Version', 'Last updated', 'Install ID'].map((label, index) => (
          <div className="space-y-1.5" key={index}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <Skeleton className="h-5 w-28" />
          </div>
        ))}
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

  if (title === 'General') {
    return (
      <FieldGroup>
        <Field>
          <FieldLabel>Avatar</FieldLabel>
          <div className="flex items-center gap-2">
            <Skeleton className="size-10 rounded-full" />
            <Button variant="outline" size="sm" disabled>
              <UploadIcon data-icon="inline-start" />
              Upload image
            </Button>
          </div>
        </Field>
        <PendingField label="Name (required)" />
        <PendingField label="Username (required)" />
      </FieldGroup>
    )
  }

  return (
    <PendingField
      label="Email (required)"
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
